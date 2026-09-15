/**
 * note エディタの公開設定画面の実DOM偵察 (第2回・title/body 入力済み) [Phase2]。
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-editor-recon2.mjs
 *
 * note_accounts.session_state_enc (KDP_CRED_KEY) を使う。タイトル/本文にダミーを入れて
 * 「公開に進む」を有効化し、公開設定モーダル/画面のセレクタを採取する。
 * 「公開」ボタンはクリックしない(実公開はしない)。最後に「下書き保存」で終了する
 * (下書きは note 上に残るため、確認後に手動削除できるよう note_url を出力する)。
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
const r = await c.query("select session_state_enc from note_accounts where id='note-acc-1'");
await c.end();
const enc = r.rows[0]?.session_state_enc;
if (!enc) { console.log('note_accounts.session_state_enc が無い'); process.exit(2); }
const keyHex = process.env.KDP_CRED_KEY;
if (!keyHex) { console.log('KDP_CRED_KEY が env に無い'); process.exit(2); }
const state = JSON.parse(dec(enc, keyHex));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon2-${n}.png`), fullPage: true }).catch(() => {});

const dump = async (tag) => {
  const d = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const el = (e) => ({
      tag: e.tagName, id: e.id, name: e.getAttribute('name'), type: e.getAttribute('type'),
      cls: clean(e.className && e.className.toString()).slice(0, 70),
      ph: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'), role: e.getAttribute('role'),
      ce: e.getAttribute('contenteditable'), text: clean(e.textContent).slice(0, 50), visible: vis(e),
    });
    return {
      url: location.href, title: document.title,
      inputs: [...document.querySelectorAll('input,textarea,[contenteditable="true"],[role=textbox],select')].filter(vis).map(el).slice(0, 40),
      buttons: [...document.querySelectorAll('button,[role=button],a.button')].filter(vis).map(el).slice(0, 60),
      bodyHead: clean(document.body.innerText).slice(0, 800),
    };
  }).catch((e) => ({ err: e.message }));
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(d, null, 1));
  await shot(tag);
};

await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
console.log('editor url:', page.url());

// タイトル + 本文を入力
await page.fill('textarea[placeholder="記事タイトル"]', '(recon) テスト記事タイトル').catch((e) => console.log('title fill err', e.message));
const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
await body.click().catch(() => {});
await page.keyboard.type('これは note 公開設定画面を採取するための検証用ダミー本文です。', { delay: 15 });
await page.waitForTimeout(2000);
await dump('editor-filled');

// 「公開に進む」
const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role=button]')]
    .find((x) => /^公開に進む$/.test((x.textContent || '').trim()) && (x.offsetWidth || x.offsetHeight));
  if (b) { b.click(); return true; }
  return false;
});
console.log('\n公開に進む クリック:', opened);
await page.waitForTimeout(6000);
await dump('publish-settings-filled');

// ハッシュタグ入力欄があれば軽く採取(値は入れない)、有料/価格/ラインのトグルを探索
const hasPaidToggle = await page.evaluate(() => {
  const t = document.body.innerText || '';
  return { hasPaidWord: /有料/.test(t), hasFreeWord: /無料/.test(t), hasPriceWord: /価格|円/.test(t), hasLineWord: /ここから先|続きは有料|有料ライン|販売設定/.test(t) };
});
console.log('\n有料関連の文言検知:', JSON.stringify(hasPaidToggle));

console.log('\nscreenshots: scripts/anp/out/recon2-*.png');
console.log('※ 公開ボタンは押していません。下書き保存して終了します。');

const savedDraft = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role=button]')]
    .find((x) => /^下書き保存$/.test((x.textContent || '').trim()) && (x.offsetWidth || x.offsetHeight));
  if (b) { b.click(); return true; }
  return false;
});
console.log('下書き保存クリック:', savedDraft);
await page.waitForTimeout(4000);
console.log('final url (手動削除用に控えてください):', page.url());
await shot('after-draft-save');

await browser.close();
