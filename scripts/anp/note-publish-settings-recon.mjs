// note「公開設定」画面の実 DOM 偵察 (F-ANP-42 ハッシュタグ自動設定のため)。READ-ONLY:
// 既存の下書きを開いて「公開に進む」まで進めるが **「投稿する」は押さない**。
//   bash scripts/anp/note-publish-settings-recon.sh <note_account_id>
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/anp/out');

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const accountId = process.argv[2] || 'cmu9z5oqy0000pk0lncwogh3n';
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('select id, display_name, session_state_enc from note_accounts where id=$1', [accountId]);
await c.end();
const acc = r.rows[0];
if (!acc?.session_state_enc) { console.log('no session'); process.exit(1); }
const state = JSON.parse(dec(acc.session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1200 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

// 1. 下書き一覧から 1 件開く
await page.goto('https://note.com/notes', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const drafts = await page.evaluate(() =>
  [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').filter((h) => /\/notes\/n[0-9a-z]+\/edit/.test(h)),
);
console.log('draft edit links:', JSON.stringify([...new Set(drafts)].slice(0, 10)));
if (drafts.length === 0) {
  const all = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').filter((h) => h.includes('/n')));
  console.log('page url:', page.url(), 'anchors:', JSON.stringify([...new Set(all)].slice(0, 30)));
  const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600));
  console.log('body:', JSON.stringify(txt));
}
// 下書きが無い場合は公開済み記事の編集画面を使う (「更新する」は押さないので記事は変わらない)。
let target = [...new Set(drafts)][0];
if (!target && process.env.NOTE_ID) target = `/notes/${process.env.NOTE_ID}/edit`;
if (!target) { console.log('下書きが見つからない'); await browser.close(); process.exit(1); }
await page.goto(new URL(target, 'https://note.com').href, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
console.log('editor url:', page.url());

// 2. 「公開に進む」
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button,a,div[role=button]')].find((e) => (e.textContent || '').trim() === '公開に進む');
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
console.log('公開に進む clicked:', clicked);
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(OUT, 'publish-settings.png'), fullPage: true }).catch(() => {});

// 3. 公開設定画面の入力欄を列挙
const fields = await page.evaluate(() =>
  [...document.querySelectorAll('input,textarea,select')].map((e) => ({
    tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name'), id: e.id,
    ph: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'),
    cls: (e.className || '').toString().slice(0, 50), val: (e.value || '').slice(0, 30),
  })),
);
console.log('--- fields ---');
console.log(JSON.stringify(fields, null, 1));
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('label,h2,h3,p,span,button')].map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 30 && /タグ|ハッシュ|説明|見出し|目次|予約|限定|SNS|シェア|公開/.test(t)),
);
console.log('--- labels ---');
console.log(JSON.stringify([...new Set(labels)].slice(0, 40)));
await browser.close();
