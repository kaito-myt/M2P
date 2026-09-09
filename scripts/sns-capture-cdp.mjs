/**
 * SNS(特に TikTok)セッション取り込み — 実Chrome を CDP 接続で読み取る方式 [F-077]。
 *
 * TikTok は Playwright 制御下のブラウザ(navigator.webdriver 等で検知)ではログインを
 * 完了させない。そこで **運営者の"本物の Chrome"** (自動操作フラグ無し=TikTokが信頼する)で
 * ログインしてもらい、その Chrome に CDP(--remote-debugging-port)で接続して Cookie だけ吸い出す。
 *
 * 使い方(運営者のローカル PC):
 *   1) 既存の Chrome を全部閉じる。
 *   2) デバッグポート付きで Chrome を起動し、そこで TikTok にログイン(QR/パスワードどちらでも可):
 *      ! "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\DEV\\A2P\\scripts\\.cdp-chrome"
 *   3) その Chrome の TikTok がログイン済み(おすすめ表示)になったら、別コマンドで本スクリプト:
 *      ! node scripts/sns-capture-cdp.mjs tiktok
 *
 * 出力: scripts/.sns-session-<channel>.json (storageState 相当・gitignore 済)。
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const channel = (process.argv[2] || 'tiktok').toLowerCase();
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const DOMAIN_RE = channel === 'tiktok' ? /tiktok\.com/i : channel === 'instagram' ? /instagram\.com/i : new RegExp(channel, 'i');
const LOGIN_NAMES = channel === 'tiktok' ? ['sessionid', 'sid_tt', 'sessionid_ss'] : ['sessionid'];
const SESSION_PATH = path.join(ROOT, 'scripts', `.sns-session-${channel}.json`);

function log(...a) { console.log(`[cdp-capture:${channel}]`, ...a); }

async function loadChromium() {
  const req = createRequire(path.join(ROOT, 'apps', 'worker') + path.sep);
  const pw = await import(pathToFileURL(req.resolve('playwright')).href);
  return pw.chromium ?? pw.default?.chromium;
}

function mapSameSite(s) {
  if (s === 'Strict' || s === 'Lax' || s === 'None') return s;
  return 'Lax';
}

async function main() {
  const chromium = await loadChromium();
  log(`実Chrome へ CDP 接続します: ${CDP_URL}`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    log('❌ 接続失敗:', e?.message ?? e);
    log('   → Chrome を --remote-debugging-port=9222 付きで起動しているか確認してください。');
    log('   例) "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\DEV\\A2P\\scripts\\.cdp-chrome"');
    process.exit(1);
  }

  const contexts = browser.contexts();
  const ctx = contexts[0];
  if (!ctx) { log('❌ ブラウザコンテキストが見つかりません'); process.exit(1); }

  // 1) まず storageState を試す。
  let state = await ctx.storageState().catch(() => ({ cookies: [], origins: [] }));
  let cookies = (state.cookies ?? []).filter((c) => DOMAIN_RE.test(c.domain || ''));

  // 2) 取れなければ CDP Network.getAllCookies で httpOnly 含め全取得。
  if (cookies.length === 0) {
    log('storageState に対象Cookie無し → CDP getAllCookies でフォールバック');
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const cdp = await ctx.newCDPSession(page);
    const all = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
    const mapped = (all.cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: mapSameSite(c.sameSite),
    }));
    state = { cookies: mapped, origins: state.origins ?? [] };
    cookies = mapped.filter((c) => DOMAIN_RE.test(c.domain || ''));
  }

  const hasLogin = cookies.some((c) => LOGIN_NAMES.includes(c.name) && c.value);
  log(`cookies: total=${state.cookies.length} ${channel}=${cookies.length} login(${LOGIN_NAMES.join('/')})=${hasLogin ? 'yes' : 'NO'}`);

  if (!hasLogin) {
    log(`⚠ ${channel} のログインCookieが見つかりません。その Chrome で ${channel} にログイン済み(おすすめ表示)か確認してください。`);
    log('  ログインしてから、もう一度このスクリプトを実行してください。');
    // 参考: 見つかった対象Cookie名を出す。
    log('  参考 検出Cookie名:', cookies.map((c) => c.name).join(', ') || '(なし)');
  } else {
    await writeFile(SESSION_PATH, JSON.stringify(state, null, 2), 'utf-8');
    log(`✅ セッションを保存しました: ${SESSION_PATH}`);
    log('   担当(Claude)に「終わった」と伝えてください。');
  }

  // CDP 接続を切断(実Chrome自体は閉じない)。
  try { await browser.close(); } catch { /* ignore */ }
  process.exit(hasLogin ? 0 : 2);
}

main().catch((e) => { console.error('[cdp-capture] エラー:', e?.message ?? e); process.exit(1); });
