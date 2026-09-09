/**
 * SNS(Instagram / TikTok)自動フォロー・いいねbot — ログイン済みセッション取り込みスクリプト。
 *
 * IG/TikTok は follow/like の公開 API が無いため、ブラウザ自動操作(bot)で行う。
 * その前提として「運営者が一度だけ手動でログインした状態(Cookie 等 = Playwright
 * storageState)」を取り込む。datacenter IP からの新規ログインは challenge される
 * ため、**必ず運営者のローカル PC(住宅 IP)** で実行すること。
 *
 * 使い方 (運営者のローカル PC で、チャンネルごとに 1 回ずつ):
 *   ! node scripts/sns-capture-session.mjs instagram
 *   ! node scripts/sns-capture-session.mjs tiktok
 *
 * 手順:
 *   1. 実ブラウザ(ヘッドフル)が開くので、普段どおりログイン(2FA も画面で完了)。
 *   2. タイムラインが表示され、数秒待って「🔐 ログイン状態を検出」ログが出たら OK。
 *   3. ★ブラウザのウィンドウを閉じる★ だけ (Enter 不要)。
 *
 * セッションは数秒ごとに自動保存される。出力(すべて gitignore 済・秘密情報):
 *   scripts/.sns-session-<channel>.json … storageState (Cookie 等)
 *   scripts/.sns-<channel>-userdata/     … 永続ブラウザプロファイル
 *
 * 取り込み後、担当(Claude)が worker の API_CRED_KEY で暗号化して DB
 * (promotion_channel_settings.browser_session_enc) に保存する。
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const CHANNELS = {
  instagram: {
    startUrl: 'https://www.instagram.com/accounts/login/',
    cookieDomain: /instagram\.com/i,
    // ログイン成功の目印になる Cookie 名。
    sessionCookie: 'sessionid',
  },
  tiktok: {
    startUrl: 'https://www.tiktok.com/login',
    cookieDomain: /tiktok\.com/i,
    // TikTok はログイン状態を sessionid / sid_tt / sessionid_ss のいずれかで持つ。
    sessionCookie: ['sessionid', 'sid_tt', 'sessionid_ss'],
  },
};

const channel = (process.argv[2] || '').toLowerCase();
if (!CHANNELS[channel]) {
  console.error(`[sns-capture] チャンネルを指定してください: instagram | tiktok`);
  console.error(`  例) node scripts/sns-capture-session.mjs instagram`);
  process.exit(1);
}
const cfg = CHANNELS[channel];

const USER_DATA_DIR = path.join(ROOT, 'scripts', `.sns-${channel}-userdata`);
const SESSION_PATH = path.join(ROOT, 'scripts', `.sns-session-${channel}.json`);
const SAVE_INTERVAL_MS = 4000;
const MAX_RUNTIME_MS = 30 * 60 * 1000;

function log(...a) {
  // eslint-disable-next-line no-console
  console.log(`[sns-capture:${channel}]`, ...a);
}

async function loadChromium() {
  const req = createRequire(path.join(ROOT, 'apps', 'worker') + path.sep);
  const pw = await import(pathToFileURL(req.resolve('playwright')).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error('playwright の chromium をロードできませんでした');
  return chromium;
}

async function main() {
  await mkdir(USER_DATA_DIR, { recursive: true });
  const chromium = await loadChromium();

  log('ブラウザを起動します…');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    locale: 'ja-JP',
    viewport: null,
    args: ['--start-maximized'],
  });

  let loginSeen = false;
  let finished = false;

  async function saveSession(reason) {
    try {
      const state = await context.storageState();
      await writeFile(SESSION_PATH, JSON.stringify(state, null, 2), 'utf-8');
      const cookies = (state.cookies ?? []).filter((c) => cfg.cookieDomain.test(c.domain));
      const sessionNames = Array.isArray(cfg.sessionCookie) ? cfg.sessionCookie : [cfg.sessionCookie];
      const hasSession = cookies.some((c) => sessionNames.includes(c.name) && c.value);
      if (!loginSeen && hasSession) {
        loginSeen = true;
        log(`🔐 ログイン状態を検出しました (${channel} Cookie ${cookies.length} 件・${sessionNames.join('/')} あり)。`);
        log(`   このまま★ブラウザを閉じる★と取り込み完了です。`);
      }
      return { cookieCount: state.cookies?.length ?? 0, channelCookies: cookies.length, hasSession };
    } catch {
      return null;
    }
  }

  async function finalize(reason) {
    if (finished) return;
    finished = true;
    const info = await saveSession(reason);
    log('');
    log(`✅ セッションを保存しました: ${SESSION_PATH}`);
    log(`   Cookie 総数: ${info?.cookieCount ?? 0} (${channel}: ${info?.channelCookies ?? 0})`);
    if (!info?.hasSession) {
      const names = Array.isArray(cfg.sessionCookie) ? cfg.sessionCookie.join('/') : cfg.sessionCookie;
      log(`   ⚠ ${names} Cookie 未検出。ログインが完了していない可能性があります。`);
      log(`     もう一度実行し、タイムラインが表示されてから閉じてください。`);
    }
    log('   完了です。担当(Claude)に「終わった」と伝えてください。');
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  log(`ログインページを開きます: ${cfg.startUrl}`);
  await page.goto(cfg.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  log('');
  log('==================================================================');
  log(` 1) 開いたブラウザで ${channel} に普段どおりログイン(2FA も画面で完了)。`);
  log(' 2) タイムラインが表示され「🔐 ログイン状態を検出」ログが出たら OK。');
  log(' 3) ★ブラウザのウィンドウを閉じる★ だけ (Enter 不要)。');
  log('==================================================================');
  log('');

  context.on('close', () => void finalize('browser-closed'));
  process.on('SIGINT', () => void finalize('sigint'));
  process.on('SIGTERM', () => void finalize('sigterm'));

  const timer = setInterval(() => void saveSession('interval'), SAVE_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => void finalize('max-runtime'), MAX_RUNTIME_MS).unref?.();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[sns-capture] エラー:', err?.message ?? err);
  process.exit(1);
});
