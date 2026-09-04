/** 楽天Kobo(KWL) 新規作品登録フローの偵察。DB保存済みセッションを復号して内部ページを開く。
 *  bash scripts/paperback/pb-env.sh 相当のenv(DBURL, KDP_CRED_KEY) + node kwl-recon.mjs [url]
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/kobo/out'); fs.mkdirSync(OUT, { recursive: true });

function decrypt(b64) {
  const raw = Buffer.from(b64, 'base64');
  const key = Buffer.from(process.env.KDP_CRED_KEY, 'hex');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(decrypt(r.rows[0].kobo_session_state_enc));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1100 } });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `kwl-${n}.png`), fullPage: true }).catch(() => {});

const url = process.argv[2] || 'https://rakutenkwl.kobo.com/v2/ebooks';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title().catch(() => '?'));
const info = await page.evaluate(() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    loginWall: /captcha|ログイン|Sign in/i.test(t.slice(0, 300)) && !!document.querySelector('input[type=password]'),
    links: [...document.querySelectorAll('a,button')].map((a) => ({ t: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), href: a.getAttribute('href') || '' })).filter((x) => x.t && /新規|作成|登録|追加|new|create|add|アップロード|出版|作品/i.test(x.t)).slice(0, 20),
    headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)).filter(Boolean).slice(0, 12),
    text: t.slice(0, 800),
  };
});
console.log('loginWall:', info.loginWall);
console.log('NEW-links:', JSON.stringify(info.links, null, 1));
console.log('HEADINGS:', JSON.stringify(info.headings));
console.log('TEXT:', info.text);
await shot('main');
await browser.close();
process.exit(0);
