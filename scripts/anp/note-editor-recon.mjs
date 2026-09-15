/**
 * note エディタの実DOM偵察（非破壊・下書きは保存しない）。
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-editor-recon.mjs
 *
 * 目的: Phase 2 (note 公開オートメーション) の実装前に、新規記事エディタの
 *   タイトル欄 / 本文欄 / 見出し画像 / 公開設定 / 有料設定 のセレクタと挙動を採取する。
 * セッション: promotion_channel_settings.config_json.note_session_enc (API_CRED_KEY で暗号化)。
 * 結果は docs/11 §2 へ転記する (CLAUDE.md ルール #8)。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/anp/out');
fs.mkdirSync(OUT, { recursive: true });

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("select config_json from promotion_channel_settings where channel='note'");
await c.end();
const enc = r.rows[0]?.config_json?.note_session_enc;
if (!enc) { console.log('note_session_enc が無い'); process.exit(2); }
const keyHex = process.env.API_CRED_KEY;
if (!keyHex) { console.log('API_CRED_KEY が env に無い (pb-env.sh は取らないので railway variables から)'); process.exit(2); }
const state = JSON.parse(dec(enc, keyHex));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon-${n}.png`), fullPage: true }).catch(() => {});

const dump = async (tag) => {
  const d = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const el = (e) => ({
      tag: e.tagName, id: e.id, name: e.getAttribute('name'), type: e.getAttribute('type'),
      cls: clean(e.className && e.className.toString()).slice(0, 70),
      ph: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'),
      ce: e.getAttribute('contenteditable'), text: clean(e.textContent).slice(0, 40), visible: vis(e),
    });
    return {
      url: location.href, title: document.title,
      inputs: [...document.querySelectorAll('input,textarea,[contenteditable="true"],[role=textbox]')].filter(vis).map(el).slice(0, 30),
      buttons: [...document.querySelectorAll('button,[role=button],a.button')].filter(vis).map(el).slice(0, 40),
      fileInputs: [...document.querySelectorAll('input[type=file]')].map(el),
      bodyHead: clean(document.body.innerText).slice(0, 300),
    };
  }).catch((e) => ({ err: e.message }));
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(d, null, 1));
  await shot(tag);
};

// 1) ログイン状態の確認
await page.goto('https://note.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);
const loggedIn = await page.evaluate(() => !document.querySelector('a[href*="/login"]') || !!document.querySelector('[href*="/notes/new"], a[href="/notes/new"]'));
console.log('ログイン状態(推定):', loggedIn, page.url());
await shot('home');

// 2) 新規記事エディタ
await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
await dump('editor-initial');

// 3) 「公開設定」に相当するボタンを探して押し、価格/有料の設定UIを採取(保存はしない)
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role=button]')]
    .find((x) => /公開に進む|公開設定|次へ|公開/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight));
  if (b) { b.click(); return (b.textContent || '').trim(); }
  return null;
});
console.log('\n公開系ボタンをクリック:', opened);
await page.waitForTimeout(6000);
await dump('publish-settings');

console.log('\nscreenshots: scripts/anp/out/recon-*.png');
console.log('※ 何も保存していません。ブラウザを閉じます。');
await browser.close();
