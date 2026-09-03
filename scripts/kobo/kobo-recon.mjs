/** 楽天Kobo (Kobo Writing Life) 偵察: ログイン状態と画面構造を確認。
 *  node scripts/kobo/kobo-recon.mjs [url]
 *  プロファイル scripts/.kobo-userdata (初回は手動ログイン待ち)
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kobo-userdata');
const OUT = path.join(REPO, 'scripts/kobo/out');
fs.mkdirSync(OUT, { recursive: true });
const url = process.argv[2] || 'https://rakutenkwl.kobo.com/v2/ebooks';

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1600, height: 1100 } });
ctx.setDefaultTimeout(45000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon-${n}.png`), fullPage: true }).catch(() => {});

await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('goto err:', e.message.slice(0, 80)));
await page.waitForTimeout(8000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title().catch(() => '?'));
const st = await page.evaluate(() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    loginWall: /ログイン|Sign in|sign_in|パスワード|Rakuten ID|楽天ID/i.test(t.slice(0, 3000)) && !!document.querySelector('input[type=password], #loginInner_u, [name=username]'),
    captcha: /captcha|признать|признат|hcaptcha|recaptcha/i.test(document.documentElement.innerHTML),
    headings: [...document.querySelectorAll('h1,h2,h3,[class*=title]')].slice(0, 15).map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean),
    inputs: [...document.querySelectorAll('input,select,textarea')].slice(0, 40).map((i) => `${i.tagName.toLowerCase()}#${i.id || ''}[name=${i.name || ''}][type=${i.type || ''}]`),
    buttons: [...document.querySelectorAll('button,[role=button],a.btn,input[type=submit]')].slice(0, 30).map((b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean),
    text: t.slice(0, 1200),
  };
});
console.log('loginWall:', st.loginWall, 'captcha:', st.captcha);
console.log('HEADINGS:', JSON.stringify(st.headings, null, 1));
console.log('INPUTS:', JSON.stringify(st.inputs, null, 1));
console.log('BUTTONS:', JSON.stringify(st.buttons, null, 1));
console.log('TEXT:', st.text);
await shot('main');
console.log('RECON DONE (Chromeは開いたまま維持: 手動ログイン可)');
// ログイン待ちモード: 5分間キープしてから閉じる(手動ログインのセッション保存用)
if (process.argv.includes('--keep')) { await page.waitForTimeout(300000); }
await ctx.close();
process.exit(0);
