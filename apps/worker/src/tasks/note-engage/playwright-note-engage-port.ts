/**
 * note 自動フォロー & スキ(いいね)の Playwright 実装 [F-091]。
 *
 * 取り込み済みログインセッション(storageState)を再利用し、対象を開いて操作する。
 *   - follow: プロフィール(https://note.com/<urlname>)を開き「フォロー」ボタンを押す。
 *   - like  : 記事(https://note.com/<urlname>/n/<id>)を開き「スキ」ボタンを押す。
 * playwright の import は本ファイルに閉じる(evaluate はブラウザ側実行)。
 *
 * 1 ブラウザセッション = 「ログイン確認 → (収穫) → 操作」。ブラウザ枠 (launchBrowser のセマフォ) は
 * kdp.submit / paperback.submit と共有なので、アカウントあたり取得 1 回に抑える。
 *
 * **2026-10-19 判明**: note の検索ページ / プロフィールはログアウトでも 200 の公開ページで、
 * /login へのリダイレクトではセッション切れを検出できない。死んだセッションでは「フォロー」を
 * 押してもログイン誘導が出るだけ。よって (a) 操作前に current_user API で肯定的にログインを確認し、
 * (b) クリック後に状態を読み直して「フォロー中/スキ済み」になって初めて done を返す。
 */
import { launchBrowser, UA, LAUNCH_ARGS } from '../../browser/launch.js';

import { createLogger } from '@a2p/contracts/logger';

import {
  judgeCurrentUser,
  type NoteEngageArgs,
  type NoteEngageOutcome,
  type NoteEngagePort,
  type NoteEngagePortResult,
  type NoteEngageTarget,
  type NoteHarvestCard,
  type NoteSessionArgs,
  type NoteSessionResult,
} from './note-engage-port.js';

const log = createLogger('worker.note-engage.playwright');

/** navigator.webdriver を隠す (従来この引数は定義だけで未使用だった)。 */
const NOTE_LAUNCH_ARGS = [...LAUNCH_ARGS, '--disable-blink-features=AutomationControlled'];
const NAV_TIMEOUT_MS = 45_000;
const CURRENT_USER_URL = 'https://note.com/api/v2/current_user';
/**
 * レート制限/一時ブロックの文言。**ページ本文全体には当てない**: 検索結果は第三者の記事タイトルで
 * 埋まり、「問題が発生しました」等の日常語で誤爆する。エラー/トースト/ダイアログ領域に限定して使う。
 */
export const BLOCK_RE =
  /(しばらく時間をおいて|後でもう一度|一時的に制限|制限されています|too many|rate limit|操作をブロック|問題が発生しました)/i;
const ALERT_SELECTOR = '[role="alert"], [role="alertdialog"], [class*="oast"], [class*="rror"]';

export function createPlaywrightNoteEngagePort(): NoteEngagePort {
  return {
    engageAll: async (args) => {
      const r = await runSession({ ...args, queries: [], limit: 0, selectTargets: () => args.targets });
      return { outcomes: r.outcomes, blocked: r.blocked };
    },
    harvestAndEngage: (args) => runSession(args),
  };
}

type Page = import('playwright').Page;

async function runSession(args: NoteSessionArgs | (NoteEngageArgs & NoteSessionArgs)): Promise<NoteSessionResult> {
  const outcomes: NoteEngageOutcome[] = [];
  const harvest = { pageOpened: false, cards: 0, selected: 0 };
  const done = (blocked?: string): NoteSessionResult => ({ outcomes, blocked, harvest });

  let storageState: unknown;
  try {
    storageState = JSON.parse(args.sessionState);
  } catch {
    return done('session_invalid_json');
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return done(`playwright_unavailable:${errMsg(err)}`);
  }

  // BrowserSlotTimeoutError はここから投げられる。呼出側 (note-engage.ts) が捕まえて
  // そのアカウントだけ skipped にする (タスク全体を落として再試行 = 再課金にしない)。
  const browser = await launchBrowser(
    { label: 'note.engage', args: NOTE_LAUNCH_ARGS, ...(args.proxy ? { proxy: args.proxy } : {}) },
    { launch: (o) => chromium.launch(o as never) },
  );
  if (args.proxy) log.info({ server: args.proxy.server }, 'note engage via home proxy');

  let blocked: string | undefined;
  try {
    const context = await browser.newContext({
      storageState: storageState as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    // tsx(esbuild keepNames) の __name 未定義対策(note/KDP port と同じ no-op シム)。
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });

    // (a) ログイン済みの肯定的シグナル。無ければ何も操作しない。
    try {
      const res = await context.request.get(CURRENT_USER_URL, { timeout: NAV_TIMEOUT_MS });
      const body = await res.json().catch(() => null);
      const verdict = judgeCurrentUser(res.status(), body);
      if (verdict !== 'ok') {
        // 診断用: 本文・クッキーは出さない。WAF の HTML か API の形変更かを後から区別できるように。
        log.warn({ status: res.status(), contentType: res.headers()['content-type'], verdict }, 'note current_user 判定が ok でない');
      }
      if (verdict === 'expired') return done('session_expired');
      if (verdict === 'unknown') return done(`session_check_failed:${res.status()}`);
    } catch (err) {
      return done(`session_check_failed:${errMsg(err)}`);
    }

    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    let targets: NoteEngageTarget[] = 'targets' in args ? args.targets : [];
    if (args.queries.length > 0) {
      const h = await harvestCards(page, args.queries, args.limit);
      harvest.pageOpened = h.pageOpened;
      harvest.cards = h.cards.length;
      if (h.blocked) return done(h.blocked);
      targets = args.selectTargets(h.cards);
      harvest.selected = targets.length;
    } else {
      harvest.pageOpened = true;
    }

    let followDone = 0;
    let likeDone = 0;
    for (const target of targets) {
      if (target.action === 'follow' && followDone >= args.maxFollow) continue;
      if (target.action === 'like' && likeDone >= args.maxLike) continue;
      try {
        const resp = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2500 + Math.floor(Math.random() * 1500));

        if (/\/login\b/i.test(page.url())) {
          blocked = 'session_expired';
          break;
        }
        if (await looksBlocked(page, resp?.status())) {
          blocked = 'action_blocked';
          break;
        }

        const outcome =
          target.action === 'follow'
            ? await doFollow(page, target.handle, target.url)
            : await doLike(page, target.handle, target.url);
        outcomes.push(outcome);
        if (outcome.status === 'done') {
          if (target.action === 'follow') followDone += 1;
          else likeDone += 1;
        }

        if (await looksBlocked(page)) {
          blocked = 'action_blocked';
          break;
        }
        await page.waitForTimeout(jitter());
      } catch (err) {
        outcomes.push({
          action: target.action,
          handle: target.handle,
          url: target.url,
          status: 'failed',
          error: errMsg(err),
        });
        await page.waitForTimeout(jitter());
      }
    }
  } catch (err) {
    blocked = blocked ?? `context_error:${errMsg(err)}`;
  } finally {
    await browser.close().catch(() => {});
  }

  return done(blocked);
}

/**
 * レート制限の判定。HTTP 429 か、エラー/トースト/ダイアログ領域の文言のみ (ページ本文全体は見ない)。
 * セレクタは実機未検証。外れても「検出できない」だけで誤検出はしない側に倒す。
 */
async function looksBlocked(page: Page, status?: number): Promise<boolean> {
  if (status === 429) return true;
  const texts = await page
    .locator(ALERT_SELECTOR)
    .evaluateAll((els) => els.slice(0, 10).map((e) => ((e as HTMLElement).innerText || '').slice(0, 300)))
    .catch(() => [] as string[]);
  return texts.some((t) => BLOCK_RE.test(t));
}

/**
 * note.com の検索 (新着順) を開き、記事カードから実在の著者 urlname と記事 ID を収穫する。
 * 記事リンクは `https://note.com/<urlname>/n/<id>` の形。数回スクロールして遅延読込を取る。
 */
async function harvestCards(
  page: Page,
  queries: string[],
  limit: number,
): Promise<{ cards: NoteHarvestCard[]; pageOpened: boolean; blocked?: string }> {
  const cards: NoteHarvestCard[] = [];
  const seen = new Set<string>();
  let pageOpened = false;
  for (const q of queries) {
    if (cards.length >= limit) break;
    try {
      const resp = await page.goto(`https://note.com/search?context=note&sort=new&q=${encodeURIComponent(q)}`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(2500 + Math.floor(Math.random() * 1500));
      if (/\/login\b/i.test(page.url())) return { cards, pageOpened, blocked: 'session_expired' };
      if (await looksBlocked(page, resp?.status())) return { cards, pageOpened, blocked: 'action_blocked' };
      pageOpened = true;
      for (let i = 0; i < 3; i += 1) {
        await page.mouse.wheel(0, 1800).catch(() => {});
        await page.waitForTimeout(1200 + Math.floor(Math.random() * 800));
      }
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/n/"]')].map((a) => (a as HTMLAnchorElement).href),
      );
      for (const href of hrefs) {
        const m = /^https?:\/\/note\.com\/([A-Za-z0-9_-]+)\/n\/([A-Za-z0-9]+)/.exec(href);
        if (!m) continue;
        const key = `${m[1]}/${m[2]}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ urlname: m[1]!, articleId: m[2]! });
        if (cards.length >= limit) break;
      }
    } catch (err) {
      log.warn({ q, err: errMsg(err) }, 'note harvest query failed');
    }
    await page.waitForTimeout(jitter());
  }
  return { cards, pageOpened };
}

type Locator = import('playwright').Locator;

const FOLLOW_TEXT = /^(フォロー|フォローする|フォロー中|フォローしています|Follow|Following)$/;
const FOLLOWING_TEXT = /^(フォロー中|フォローしています|Following)$/;
const LIKE_HINT = /スキ|いいね|Like/i;
const LIKED_HINT = /取り消|済み|Liked|Unlike/i;

/**
 * 操作対象のボタンを **1 本の locator** に固定する。document 全体を走査すると、プロフィールの
 * 「おすすめのクリエイター」や記事の著者/関連記事カードにいる**既にフォロー済みの別人**の
 * 「フォロー中」を拾い、押す前は already (実体のない行)、押した後はクリックが空振りでも done になる。
 * main 内の最初の一致 (ヘッダー側が DOM 順で先) → 無ければ main 外、の順。押下前後で同じ locator を読み直す。
 */
async function followButton(page: Page): Promise<Locator | null> {
  const scopes = ['main button, main [role=button], main a', 'button, [role=button]'];
  for (const sel of scopes) {
    const loc = page.locator(sel).filter({ hasText: FOLLOW_TEXT }).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

const norm = (t: string | null | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim();

/**
 * プロフィールの「フォロー」ボタンを押す。既に「フォロー中」なら already。
 * **同一ボタンを押下後に読み直し、「フォロー中」になって初めて done**。
 */
async function doFollow(page: Page, handle: string, url: string): Promise<NoteEngageOutcome> {
  const btn = await followButton(page);
  if (!btn) return { action: 'follow', handle, url, status: 'failed', error: 'follow_button_not_found' };
  const before = norm(await btn.textContent().catch(() => null));
  if (FOLLOWING_TEXT.test(before)) return { action: 'follow', handle, url, status: 'already' };
  if (!FOLLOW_TEXT.test(before)) return { action: 'follow', handle, url, status: 'failed', error: 'follow_button_not_found' };

  await btn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const after = norm(await btn.textContent().catch(() => null));
  if (FOLLOWING_TEXT.test(after)) return { action: 'follow', handle, url, status: 'done' };
  return { action: 'follow', handle, url, status: 'failed', error: 'follow_not_confirmed' };
}

/** 記事のスキボタン (アクションバー優先 → main → 全体)。aria-label を持つものを優先する。 */
async function likeButton(page: Page): Promise<Locator | null> {
  const scopes = ['main [class*="ction"]', 'main', 'body'];
  for (const scope of scopes) {
    const byAria = page
      .locator(`${scope} :is(button,[role=button])[aria-label*="スキ"], ${scope} :is(button,[role=button])[aria-label*="いいね"]`)
      .first();
    if ((await byAria.count().catch(() => 0)) > 0) return byAria;
    const byText = page.locator(`${scope} :is(button,[role=button])`).filter({ hasText: LIKE_HINT }).first();
    if ((await byText.count().catch(() => 0)) > 0) return byText;
  }
  return null;
}

async function isLiked(btn: Locator): Promise<boolean> {
  const pressed = await btn.getAttribute('aria-pressed').catch(() => null);
  const label = (await btn.getAttribute('aria-label').catch(() => '')) + ' ' + norm(await btn.textContent().catch(() => ''));
  return pressed === 'true' || LIKED_HINT.test(label);
}

/** 記事の「スキ」ボタンを押す。同一ボタンが「スキ済み」へ変わったのを確認して done。 */
async function doLike(page: Page, handle: string, url: string): Promise<NoteEngageOutcome> {
  const btn = await likeButton(page);
  if (!btn) return { action: 'like', handle, url, status: 'failed', error: 'like_button_not_found' };
  if (await isLiked(btn)) return { action: 'like', handle, url, status: 'already' };

  await btn.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (await isLiked(btn)) return { action: 'like', handle, url, status: 'done' };
  return { action: 'like', handle, url, status: 'failed', error: 'like_not_confirmed' };
}

function jitter(): number {
  // 人間的な間(8〜25秒)。1回の実行で大量に連打しない (2026-10-19 に 6〜16 秒から拡大)。
  return 8000 + Math.floor(Math.random() * 17000);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
