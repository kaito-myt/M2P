/**
 * note 自動フォロー & スキ(いいね)の Playwright 実装 [F-091]。
 *
 * 取り込み済みログインセッション(storageState)を再利用し、対象を開いて操作する。
 *   - follow: プロフィール(https://note.com/<urlname>)を開き「フォロー」ボタンを押す。
 *   - like  : 記事(https://note.com/<urlname>/n/<id>)を開き「スキ」ボタンを押す。
 * playwright の import は本ファイルに閉じる(evaluate はブラウザ側実行)。
 *
 * note-publisher-port と同じく、セレクタは堅牢に(見つからなければ failed=skip)。
 * ログイン誘導(セッション切れ)やレート制限文言を検知したら即中断(blocked)して
 * 呼出側が停止&通知する。トークン/セッションはログに出さない。
 */
import { createLogger } from '@a2p/contracts/logger';

import type {
  NoteEngageArgs,
  NoteEngageOutcome,
  NoteEngagePort,
  NoteEngagePortResult,
} from './note-engage-port.js';

const log = createLogger('worker.note-engage.playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

const NAV_TIMEOUT_MS = 45_000;
/** レート制限/一時ブロックの文言。 */
const BLOCK_RE =
  /(しばらく時間をおいて|後でもう一度|一時的に制限|制限されています|too many|rate limit|操作をブロック|問題が発生しました)/i;

export function createPlaywrightNoteEngagePort(): NoteEngagePort {
  return { engageAll };
}

async function engageAll(args: NoteEngageArgs): Promise<NoteEngagePortResult> {
  const outcomes: NoteEngageOutcome[] = [];

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
  if (args.proxy) log.info({ server: args.proxy.server }, 'note engage via home proxy');

  let blocked: string | undefined;
  let followDone = 0;
  let likeDone = 0;
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
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    for (const target of args.targets) {
      if (target.action === 'follow' && followDone >= args.maxFollow) continue;
      if (target.action === 'like' && likeDone >= args.maxLike) continue;
      try {
        await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(2500 + Math.floor(Date.now() % 1500));

        const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        // セッション切れ = ログイン/会員登録に誘導される(URL か本文)。
        if (/\/login\b/i.test(page.url())) {
          blocked = 'session_expired';
          break;
        }
        if (BLOCK_RE.test(bodyText)) {
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

        // 操作後にブロック文言が出ていないか。
        const afterText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        if (BLOCK_RE.test(afterText)) {
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

  return { outcomes, blocked };
}

/**
 * プロフィールの「フォロー」ボタンを押す。既に「フォロー中」なら already。
 * note のフォローボタンはヘッダー領域の button/[role=button] で、テキストは「フォロー」。
 * フォロー済みは「フォロー中」。厳密一致で判定し、無ければ failed(セレクタ変化/非公開など)。
 */
async function doFollow(
  page: import('playwright').Page,
  handle: string,
  url: string,
): Promise<NoteEngageOutcome> {
  const state = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button,[role=button],a')] as HTMLElement[];
    const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;
    const norm = (el: HTMLElement) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    // 既にフォロー中か。
    const following = btns.find((b) => visible(b) && /^(フォロー中|フォローしています|Following)$/.test(norm(b)));
    if (following) return 'already';
    // 未フォローの「フォロー」ボタン。
    const follow = btns.find((b) => visible(b) && /^(フォロー|フォローする|Follow)$/.test(norm(b)));
    if (follow) {
      follow.click();
      return 'clicked';
    }
    return 'not_found';
  });

  if (state === 'already') {
    return { action: 'follow', handle, url, status: 'already' };
  }
  if (state === 'clicked') {
    await page.waitForTimeout(1800);
    return { action: 'follow', handle, url, status: 'done' };
  }
  return { action: 'follow', handle, url, status: 'failed', error: 'follow_button_not_found' };
}

/**
 * 記事の「スキ」ボタンを押す。既にスキ済みなら already。
 * note のスキボタンは aria-label に「スキ」を含む(押下後は「スキ済み/スキを取り消す」)。
 * aria-pressed / テキストで既済みを判定。無ければ failed。
 */
async function doLike(
  page: import('playwright').Page,
  handle: string,
  url: string,
): Promise<NoteEngageOutcome> {
  const state = await page.evaluate(() => {
    const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;
    const candidates = [...document.querySelectorAll('button,[role=button]')] as HTMLElement[];
    // aria-label / テキストに「スキ」を含む操作ボタンを探す。
    const likeBtn = candidates.find((b) => {
      if (!visible(b)) return false;
      const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      return /スキ|いいね|Like/i.test(label);
    });
    if (!likeBtn) return 'not_found';
    const label = (likeBtn.getAttribute('aria-label') || '') + ' ' + (likeBtn.textContent || '');
    const pressed = likeBtn.getAttribute('aria-pressed');
    // 既にスキ済み: aria-pressed=true か「取り消す/スキ済み」表記。
    if (pressed === 'true' || /取り消|済み|Liked|Unlike/i.test(label)) return 'already';
    likeBtn.click();
    return 'clicked';
  });

  if (state === 'already') {
    return { action: 'like', handle, url, status: 'already' };
  }
  if (state === 'clicked') {
    await page.waitForTimeout(1500);
    return { action: 'like', handle, url, status: 'done' };
  }
  return { action: 'like', handle, url, status: 'failed', error: 'like_button_not_found' };
}

function jitter(): number {
  // 人間的な間(6〜16秒)。テストでは maxFollow/maxLike=0 or モックで実待機を避ける。
  return 6000 + Math.floor(Date.now() % 10000);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
