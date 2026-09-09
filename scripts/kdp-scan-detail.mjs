// KDP 本棚を READ-ONLY でスキャンし、検索語ごとに「全 ASIN + live/下書き状態 + 行タイトル」を列挙する。
// 取り下げ対象(重複本)の実 ASIN を特定するための調査専用。破壊的操作は一切しない。
// 使い方: node scripts/kdp-scan-detail.mjs "検索語1" "検索語2" ...
//   env: DBURL(認証リレー用), AMAZON_EMAIL/PASSWORD(再認証), LINE_*(OTPリレー)
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
const reqWorker = createRequire('C:/DEV/A2P/apps/worker/package.json');
const reqPg = createRequire('C:/DEV/A2P/node_modules/.pnpm/pg@8.21.0/node_modules/pg/');
const chromium = reqWorker('playwright').chromium;
const { Client } = reqPg('pg');

const TERMS = process.argv.slice(2);
if (TERMS.length === 0) { console.error('usage: node kdp-scan-detail.mjs "term" ...'); process.exit(1); }
const USERDATA = 'C:/DEV/A2P/scripts/.kdp-userdata';
const BOOKSHELF = 'https://kdp.amazon.co.jp/ja_JP/bookshelf';
const STAGE = path.join(os.tmpdir(), 'kdp-publish-stage');
const AMZ_EMAIL = process.env.AMAZON_EMAIL || '';
const AMZ_PASS = process.env.AMAZON_PASSWORD || '';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_USER = process.env.LINE_USER_ID || process.env.LINE_ALLOWED_USER_ID || '';
const OTP_SEL = '#auth-mfa-otpcode, input[name="otpCode"], #cvf-input-code, input[name="code"]';
const MAX_OTP_ROUNDS = 3;
const genId = () => 'kar_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dbUrl = process.env.DBURL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

async function pushLine(text) {
  if (!LINE_TOKEN || !LINE_USER) { log('  LINE未設定 — push省略'); return false; }
  try {
    const res = await fetch(LINE_PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN }, body: JSON.stringify({ to: LINE_USER, messages: [{ type: 'text', text }] }) });
    return res.ok;
  } catch { return false; }
}
async function dbClient() { const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }); c.on('error', () => {}); await c.connect(); return c; }
async function awaitOtpOnce(db, page, prompt) {
  const id = genId(); const expires = new Date(Date.now() + 5 * 60 * 1000);
  await db.query(`INSERT INTO kdp_auth_requests (id, purpose, status, prompt, expires_at) VALUES ($1,'kdp_login_otp','pending',$2,$3)`, [id, prompt, expires]);
  await pushLine(prompt);
  for (let i = 0; i < 150; i++) {
    const r = await db.query(`SELECT code, status FROM kdp_auth_requests WHERE id=$1`, [id]);
    const row = r.rows[0];
    if (row && row.status === 'fulfilled' && row.code) { await db.query(`UPDATE kdp_auth_requests SET status='consumed', consumed_at=now() WHERE id=$1`, [id]); return row.code; }
    await page.waitForTimeout(2000);
  }
  await db.query(`UPDATE kdp_auth_requests SET status='expired' WHERE id=$1 AND status='pending'`, [id]);
  return null;
}
async function relayOtp(db, page, otpInput) {
  for (let round = 1; round <= MAX_OTP_ROUNDS; round++) {
    const prompt = round === 1 ? '🔐 A2P: KDP本棚スキャンにログイン認証が必要です。6桁コードを返信してください（5分以内）。' : `🔁 A2P: 認証コード再送（${round}/${MAX_OTP_ROUNDS}）。最新の6桁を返信してください。`;
    log(`  LINE認証リレー round ${round} — 返信待機中...`);
    const code = await awaitOtpOnce(db, page, prompt);
    if (!code) continue;
    let el = otpInput; if (!(await el?.isVisible().catch(() => false))) el = await page.$(OTP_SEL).catch(() => null);
    if (el) await el.fill(code).catch(() => {});
    await page.check('#auth-mfa-remember-device').catch(() => {});
    const submit = (await page.$('#auth-signin-button').catch(() => null)) ? '#auth-signin-button' : (await page.$('#cvf-submit-otp-button').catch(() => null)) ? '#cvf-submit-otp-button' : 'input[type="submit"]';
    await page.click(submit).catch(() => {}); await page.waitForTimeout(5000);
    const stillOtp = await page.$(OTP_SEL).catch(() => null);
    if (!(stillOtp && (await stillOtp.isVisible().catch(() => false)))) { log('  認証成功'); return true; }
    otpInput = stillOtp;
  }
  return false;
}
async function passReauth(page, db) {
  const authFormOrPicker = async () => page.$('#ap_password, input[type="password"][name="password"], #signInSubmit, #ap_email, ' + OTP_SEL + ', a[href*="signin"], .cvf-account-switcher-spacing, [data-name="accountSwitcher"]').catch(() => null);
  if (!/signin|\/ap\//i.test(page.url()) && !(await authFormOrPicker())) return true;
  log('  🔐 再認証要求 → 自動通過を試行');
  let autoTries = 0;
  for (let i = 0; i < 120; i++) {
    if (!(await page.$('#ap_password, input[type="password"][name="password"]').catch(() => null))) {
      await page.evaluate((email) => {
        const nodes = Array.from(document.querySelectorAll('a, div[role="button"], button, [data-a-target], .a-link-normal'));
        const t = (email || '').toLowerCase();
        const hit = nodes.find((n) => (n.textContent || '').toLowerCase().includes(t) && t);
        if (hit) hit.click();
      }, AMZ_EMAIL).catch(() => {});
    }
    const emailEl = await page.$('#ap_email, input[type="email"][name="email"]').catch(() => null);
    if (emailEl && AMZ_EMAIL && (await emailEl.isVisible().catch(() => false))) { await emailEl.fill(AMZ_EMAIL).catch(() => {}); await page.click('#continue, input#continue').catch(() => {}); await page.waitForTimeout(2500); }
    const otpEl = await page.$(OTP_SEL).catch(() => null);
    if (otpEl && (await otpEl.isVisible().catch(() => false))) { if (!(await relayOtp(db, page, otpEl))) return false; }
    const passEl = await page.$('#ap_password, input[type="password"][name="password"]').catch(() => null);
    if (passEl && (await passEl.isVisible().catch(() => false)) && AMZ_PASS && autoTries < 3) {
      autoTries++; await passEl.click().catch(() => {}); await passEl.fill('').catch(() => {}); await passEl.type(AMZ_PASS, { delay: 25 }).catch(() => {});
      await page.check('#auth-remember-me, #rememberMe').catch(() => {}); await page.click('#signInSubmit, input#signInSubmit').catch(() => {}); await page.waitForTimeout(4000);
    }
    if (/\/bookshelf/.test(page.url()) && !/signin/i.test(page.url())) return true;
    if (!/signin|\/ap\//i.test(page.url()) && !(await page.$('#ap_password, ' + OTP_SEL).catch(() => null))) { await page.waitForTimeout(1500); return true; }
    await page.waitForTimeout(2500);
  }
  return false;
}
async function getSearchBox(page, db) {
  for (let i = 0; i < 6; i++) {
    await passReauth(page, db);
    const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"], input[name*="search"]').catch(() => null);
    if (sb && (await sb.isVisible().catch(() => false))) return sb;
    await page.waitForTimeout(2500);
  }
  return null;
}

(async () => {
  const db = await dbClient();
  const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1100 }, args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.setDefaultTimeout(60000);
  try {
    for (const term of TERMS) {
      await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(5000);
      const sb = await getSearchBox(page, db);
      if (!sb) { log(`[${term}] no_search_box`); continue; }
      await sb.fill(''); await sb.fill(term.trim()); await page.keyboard.press('Enter');
      await page.waitForTimeout(6000);
      const rows = await page.evaluate(() => {
        const out = [];
        // 各書籍行: タイトルリンク近傍に "…" アクションボタン。行コンテナを起点に抽出。
        const btns = Array.from(document.querySelectorAll('button[id$="-other-actions-announce"]'));
        for (const b of btns) {
          let el = b, container = null;
          for (let i = 0; i < 10 && el; i++) { el = el.parentElement; if (el && (el.textContent || '').match(/B0[A-Z0-9]{8}/)) { container = el; break; } }
          const scope = container || document;
          const html = (container ? container.outerHTML : '');
          const asins = [...new Set((html.match(/B0[A-Z0-9]{8}/g) || []))];
          const txt = (container ? container.textContent : '') || '';
          // タイトル候補
          let title = '';
          const tEl = scope.querySelector && scope.querySelector('a[href*="title"], [id^="title"], .a-size-base-plus, .a-size-medium');
          if (tEl) title = (tEl.textContent || '').trim();
          if (!title) title = txt.replace(/\s+/g, ' ').trim().slice(0, 60);
          const live = /販売中|ライブ|Live/i.test(txt) || (container ? !!container.querySelector('[id*="live-book-actions"]') : false);
          const review = /レビュー中|出版準備中|審査/i.test(txt);
          const draft = /下書き|出版停止|アーカイブ|Draft/i.test(txt);
          out.push({ asins, title: title.slice(0, 70), live, review, draft });
        }
        // フォールバック: ボタンが取れない場合はページ全体の ASIN
        const allAsins = [...new Set(((document.documentElement.outerHTML).match(/B0[A-Z0-9]{8}/g) || []))];
        return { rows: out, allAsins };
      }).catch(() => null);
      if (!rows) { log(`[${term}] eval_failed`); continue; }
      log(`[${term}] rows=${rows.rows.length} allAsins=${JSON.stringify(rows.allAsins)}`);
      for (const r of rows.rows) log(`   • ${JSON.stringify(r.asins)} live=${r.live} review=${r.review} draft=${r.draft} | ${r.title}`);
      await page.screenshot({ path: path.join(STAGE, `scan-${term.slice(0, 8)}.png`), fullPage: true }).catch(() => {});
    }
    log('scan 完了');
  } catch (e) {
    log('ERROR', e.message);
    await page.screenshot({ path: path.join(STAGE, 'scan-error.png'), fullPage: true }).catch(() => {});
  } finally {
    await page.waitForTimeout(1500);
    await ctx.close();
    await db.end();
  }
})();
