/**
 * `model.health.probe` タスク — 「動く・安い・止まらない」の要。
 *
 * カタログに載っていても実際には呼べないモデル（例: Google が `gemini-2.5-flash` を
 * "no longer available to new users" で 404 にした事例）を、**実際に1トークン叩いて**検知する。
 *
 * フロー:
 *  1. probe 対象 = 「active な model_assignment のモデル」∪「is_current な catalog のテキストモデル」。
 *  2. 各 (provider, model) を最小リクエストで叩き、available を判定
 *     （404/not found/no longer available/deprecated 等の**モデル起因の恒久失敗のみ** false。
 *      429/5xx/timeout 等の一時失敗は「不明」として据え置き＝誤判定で切替えない）。
 *  3. is_current な ModelCatalog 行に available / availability_checked_at / availability_note を書く。
 *  4. **自己修復**: active な model_assignment が available=false のモデルを指していたら、
 *     critical アラートを出し、信頼できる既定モデルへ自動切替（archive→新 active を INSERT）。
 *     → これで「モデルが黙って死んでパイプラインが数日止まる」事故を自動回避する。
 *
 * 非致命設計: 個々の probe 失敗や1プロバイダ障害で task 全体は止めない。
 */
import type { JobHelpers, Task } from 'graphile-worker';
import { randomUUID } from 'node:crypto';

import { getApiKey } from '@a2p/agents/lib/get-api-key';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

export const MODEL_HEALTH_PROBE_TASK_NAME = 'model.health.probe';

/** モデルが死んだとき自動退避する安全既定（信頼性重視・中コスト）。 */
const SAFE_FALLBACK = { provider: 'anthropic', model: 'claude-sonnet-4-6' } as const;

/** 画像/音声/埋め込み系はテキスト probe 対象外（別 API のため）。名前で除外。 */
function isTextModel(model: string): boolean {
  return !/(image|imagen|tts|audio|embedding|whisper|transcribe|computer-use)/i.test(model);
}

type Availability = { available: boolean; note: string } | { unknown: true; note: string };

/** 恒久的にモデルが使えないと判断できるエラーか（一時障害と区別）。 */
function isPermanentModelError(status: number | undefined, msg: string): boolean {
  const m = msg.toLowerCase();
  if (status === 404 || status === 400) {
    // 400/404 でもモデル起因のワードがあるときだけ恒久扱い
    if (/(not found|no longer available|deprecated|does not exist|not available|unsupported|invalid model|unknown model|model_not_found)/.test(m)) {
      return true;
    }
    return status === 404; // 404 は基本モデル不在
  }
  if (status === 403 && /(permission|not allowed|access)/.test(m)) return true;
  return /(no longer available|deprecated|does not exist|model_not_found)/.test(m);
}

function classify(status: number | undefined, msg: string): Availability {
  if (isPermanentModelError(status, msg)) return { available: false, note: `${status ?? ''} ${msg}`.slice(0, 240) };
  // 429/5xx/timeout 等 → 判定不能（据え置き）
  return { unknown: true, note: `transient ${status ?? ''} ${msg}`.slice(0, 200) };
}

/* ── provider 別 probe（最小リクエスト） ─────────────────────────── */

async function probeGoogle(apiKey: string, model: string): Promise<Availability> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 1 } }) },
    );
    if (res.ok) return { available: true, note: 'ok' };
    const body = await res.text().catch(() => '');
    return classify(res.status, body);
  } catch (e) {
    return { unknown: true, note: 'fetch ' + (e as Error).message };
  }
}

async function probeAnthropic(apiKey: string, model: string): Promise<Availability> {
  try {
    const mod: any = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod;
    const client = new Anthropic({ apiKey });
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] });
    return { available: true, note: 'ok' };
  } catch (e: any) {
    return classify(e?.status, String(e?.message ?? e));
  }
}

async function probeOpenAI(apiKey: string, model: string): Promise<Availability> {
  try {
    const mod: any = await import('openai');
    const OpenAI = mod.default ?? mod;
    const client = new OpenAI({ apiKey });
    // retrieve はモデル存在/権限を確認できて生成パラメータ差異に悩まされない。
    await client.models.retrieve(model);
    return { available: true, note: 'ok' };
  } catch (e: any) {
    return classify(e?.status, String(e?.message ?? e));
  }
}

async function probe(provider: string, model: string, apiKey: string): Promise<Availability> {
  if (provider === 'google') return probeGoogle(apiKey, model);
  if (provider === 'anthropic') return probeAnthropic(apiKey, model);
  if (provider === 'openai') return probeOpenAI(apiKey, model);
  return { unknown: true, note: 'unsupported provider' };
}

/* ── メイン ─────────────────────────────────────────────────────── */

export interface ModelHealthProbeResult {
  probed: number;
  unavailable: number;
  healed: number;
}

export async function runModelHealthProbe(deps: { logger?: Logger } = {}): Promise<ModelHealthProbeResult> {
  const log = deps.logger ?? createLogger(`worker.${MODEL_HEALTH_PROBE_TASK_NAME}`);
  const prisma = defaultPrisma;

  const [assignments, catalog] = await Promise.all([
    prisma.modelAssignment.findMany({ where: { status: 'active' }, select: { id: true, role: true, genre: true, provider: true, model: true } }),
    prisma.modelCatalog.findMany({ where: { is_current: true }, select: { provider: true, model: true } }),
  ]);

  // probe 対象を dedup（テキストモデルのみ）
  const targets = new Map<string, { provider: string; model: string }>();
  for (const a of assignments) if (isTextModel(a.model)) targets.set(`${a.provider}/${a.model}`, { provider: a.provider, model: a.model });
  for (const c of catalog) if (isTextModel(c.model)) targets.set(`${c.provider}/${c.model}`, { provider: c.provider, model: c.model });

  const keyCache = new Map<string, string | null>();
  const getKey = async (p: string): Promise<string | null> => {
    if (!keyCache.has(p)) {
      try { keyCache.set(p, await getApiKey(p as 'anthropic' | 'openai' | 'google')); }
      catch { keyCache.set(p, null); }
    }
    return keyCache.get(p) ?? null;
  };

  const now = new Date();
  const result = new Map<string, Availability>();
  let unavailable = 0;
  for (const { provider, model } of targets.values()) {
    const apiKey = await getKey(provider);
    if (!apiKey) { result.set(`${provider}/${model}`, { unknown: true, note: 'no api key' }); continue; }
    const av = await probe(provider, model, apiKey);
    result.set(`${provider}/${model}`, av);
    if ('available' in av && av.available === false) unavailable++;
    // カタログに available を書き戻す（is_current 行）。判定不能(unknown)は据え置き。
    if ('available' in av) {
      await prisma.modelCatalog.updateMany({
        where: { provider, model, is_current: true },
        data: { available: av.available, availability_checked_at: now, availability_note: av.note },
      }).catch((e) => log.warn({ e: (e as Error).message, provider, model }, 'catalog availability write failed'));
    }
    log.info({ provider, model, av }, 'probed');
  }

  // 自己修復: active 割当が available=false のモデルを指していたら切替＋アラート
  let healed = 0;
  for (const a of assignments) {
    const av = result.get(`${a.provider}/${a.model}`);
    if (!av || !('available' in av) || av.available !== false) continue;
    // fallback: 同 provider の available=true な最安、無ければ SAFE_FALLBACK
    const alt = await pickFallback(prisma, a.provider).catch(() => null);
    const fb = alt ?? SAFE_FALLBACK;
    try {
      await prisma.$transaction([
        prisma.modelAssignment.update({ where: { id: a.id }, data: { status: 'archived', archived_at: now } }),
        prisma.modelAssignment.create({
          data: {
            id: `heal_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
            role: a.role, genre: a.genre ?? null, provider: fb.provider, model: fb.model,
            status: 'active', activated_at: now, created_by: 'system:model-health-autoheal',
          },
        }),
        prisma.alert.create({
          data: {
            kind: 'model_assignment_unavailable', severity: 'critical',
            payload_json: {
              role: a.role, genre: a.genre ?? null,
              dead: `${a.provider}/${a.model}`, note: av.note,
              healed_to: `${fb.provider}/${fb.model}`, occurred_at: now.toISOString(),
            },
          },
        }),
      ]);
      healed++;
      log.warn({ role: a.role, dead: `${a.provider}/${a.model}`, healed_to: `${fb.provider}/${fb.model}` }, 'AUTO-HEALED dead model assignment');
    } catch (e) {
      log.error({ e: (e as Error).message, role: a.role }, 'auto-heal failed');
    }
  }

  log.info({ probed: targets.size, unavailable, healed }, 'model.health.probe done');
  return { probed: targets.size, unavailable, healed };
}

/** 同 provider で available=true な最安モデルを選ぶ（無ければ null）。 */
async function pickFallback(prisma: typeof defaultPrisma, provider: string): Promise<{ provider: string; model: string } | null> {
  const rows = await prisma.modelCatalog.findMany({
    where: { provider, is_current: true, available: true },
    select: { model: true, input_price_per_mtok_usd: true, output_price_per_mtok_usd: true },
  });
  if (rows.length === 0) return null;
  rows.sort((a, b) => (Number(a.input_price_per_mtok_usd) + Number(a.output_price_per_mtok_usd)) - (Number(b.input_price_per_mtok_usd) + Number(b.output_price_per_mtok_usd)));
  return { provider, model: rows[0]!.model };
}

export const modelHealthProbeTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  await runModelHealthProbe();
};
