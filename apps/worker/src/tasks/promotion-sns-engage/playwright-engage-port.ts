/**
 * IG/TikTok 自動フォローの Playwright 実装 [F-077]。
 *
 * 取り込み済みログインセッション(storageState)を再利用し、対象プロフィールを開いて
 * フォローボタンを押す。playwright の import は本ファイルに閉じる。セレクタは実セッションで
 * 検証済み(IG: getByRole('button',{name:/フォロー|Follow/}))。
 *
 * アクションブロック(IG「後でもう一度実行してください」/ TikTok の一時制限)や
 * ログイン誘導を検知したら即中断(blocked)して呼出側が停止&通知する。
 */
import { createLogger } from '@a2p/contracts/logger';

import type {
  EngageOutcome,
  SnsEngageArgs,
  SnsEngagePort,
  SnsEngagePortResult,
} from './engage-port.js';

const log = createLogger('worker.promotion-sns-engage.playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

const NAV_TIMEOUT_MS = 45_000;
const FOLLOW_RE = /^(フォロー|フォローする|Follow|フォローバック|Follow Back)$/;
/** IG/TikTok がアクション制限をかけたときに出る文言。 */
const BLOCK_RE =
  /(後でもう一度|しばらく時間をおいて|Try Again Later|操作をブロック|Action Blocked|問題が発生しました|一時的に制限|too many|レート|rate limit)/i;
const LOGIN_RE = /(accounts\/login|\/login\b|ログインしてください|Log in|Log into)/i;

export function createPlaywrightSnsEngagePort(): SnsEngagePort {
  return { followAll };
}

async function followAll(args: SnsEngageArgs): Promise<SnsEngagePortResult> {
  const outcomes: EngageOutcome[] = [];

  let storageState: unknown;
  try {
    storageState = JSON.parse(args.sessionState);
  } catch {
    return { outcomes, blocked: 'session_invalid_json' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { outcomes, blocked: `playwright_unavailable:${errMsg(err)}` };
  }

  const browser = await chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
    ...(args.proxy ? { proxy: args.proxy } : {}),
  });
  if (args.proxy) log.info({ server: args.proxy.server, channel: args.channel }, 'sns engage via home proxy');

  let blocked: string | undefined;
  try {
    const context = await browser.newContext({
      storageState: storageState as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    let done = 0;
    for (const target of args.targets) {
      if (done >= args.maxActions) break;
      try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2500 + Math.floor((Date.now() % 1500)));

        // ログイン誘導 = セッション切れ → 中断。
        if (LOGIN_RE.test(page.url())) {
          blocked = 'session_expired';
          break;
        }
        const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        if (BLOCK_RE.test(bodyText)) {
          blocked = 'action_blocked';
          break;
        }

        // 既にフォロー済みか判定(チャンネル別セレクタ)。
        if (await isFollowing(page, args.channel)) {
          outcomes.push({ handle: target.handle, url: target.url, status: 'already' });
          await page.waitForTimeout(jitter(args));
          continue;
        }

        // フォローボタンを探して押す(チャンネル別)。
        const followBtn = followButton(page, args.channel);
        const hasFollow = (await followBtn.count().catch(() => 0)) > 0;
        if (!hasFollow) {
          // 非公開・削除済み・セレクタ変化など。失敗として記録し次へ。
          outcomes.push({ handle: target.handle, url: target.url, status: 'failed', error: 'follow_button_not_found' });
          await page.waitForTimeout(jitter(args));
          continue;
        }

        await followBtn.click({ timeout: 8000 });
        await page.waitForTimeout(2000);

        // クリック後にブロック文言が出ていないか。
        const afterText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        if (BLOCK_RE.test(afterText)) {
          blocked = 'action_blocked';
          break;
        }
        // クリックは成功。状態確認(isFollowing)は参考情報で、取れなくても done 扱い。
        await isFollowing(page, args.channel).catch(() => false);
        outcomes.push({ handle: target.handle, url: target.url, status: 'done' });
        done += 1;
        await page.waitForTimeout(jitter(args));
      } catch (err) {
        outcomes.push({ handle: target.handle, url: target.url, status: 'failed', error: errMsg(err) });
        await page.waitForTimeout(jitter(args));
      }
    }
  } catch (err) {
    blocked = blocked ?? `context_error:${errMsg(err)}`;
  } finally {
    await browser.close().catch(() => {});
  }

  return { outcomes, blocked };
}

/**
 * 未フォローの「フォロー」ボタンを返す(チャンネル別セレクタ)。
 * - IG: getByRole('button', {name:/フォロー|Follow/}) を実セッションで検証済み。
 * - TikTok: プロフィールのフォローボタンは `button[data-e2e="follow-button"]`。
 */
function followButton(page: import('playwright').Page, channel: string) {
  if (channel === 'tiktok') {
    return page.locator('button[data-e2e="follow-button"]').first();
  }
  return page.getByRole('button', { name: FOLLOW_RE }).first();
}

/**
 * 「フォロー中/Following」状態かを判定する(チャンネル別)。
 * - IG: 「フォロー中」ボタンは getByRole の accessible name が一致しない(実測)ため、
 *   ヘッダー領域のボタン innerText の厳密一致で判定する。
 * - TikTok: 既フォローは `button[data-e2e="unfollow-button"]` が出る、または follow-button の
 *   テキストが「フォロー中/Following」。
 */
async function isFollowing(page: import('playwright').Page, channel: string): Promise<boolean> {
  const labels = ['フォロー中', 'フォローしています', 'Following', 'リクエスト済み', 'Requested'];
  if (channel === 'tiktok') {
    const unfollow = await page.locator('button[data-e2e="unfollow-button"]').count().catch(() => 0);
    if (unfollow > 0) return true;
    const followText = await page
      .locator('button[data-e2e="follow-button"]')
      .first()
      .innerText()
      .catch(() => '');
    return labels.includes(followText.trim());
  }
  const texts = await page
    .$$eval('header button, header div[role="button"], section button, main header button', (els) =>
      els.map((e) => (e.textContent ?? '').trim()),
    )
    .catch(() => [] as string[]);
  return texts.some((t) => labels.includes(t));
}

function jitter(args: SnsEngageArgs): number {
  // 人間的な間(6〜16秒)。テストでは maxActions=0 or モックで実待機を避ける。
  void args;
  return 6000 + Math.floor((Date.now() % 10000));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
