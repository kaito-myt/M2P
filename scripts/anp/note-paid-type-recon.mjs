// note「公開設定 › 記事タイプ」で有料を選ぶ DOM の偵察 (2026-10-11)。
// READ-ONLY: 下書きを開いて「公開に進む」まで進め、記事タイプの DOM を出すだけ。
// **「投稿する」は押さない。**
//
//   bash scripts/anp/note-paid-type-recon.sh <note_account_id> <note_id>
//
// 背景: 有料記事の実公開が `blocked`(価格入力欄が見つからない) で止まった。
// 公開設定画面のスクリーンショットでは「記事タイプ」が**無料のまま**で、
// 価格欄はそもそも描画されていなかった。エディタ側で有料を選ぶ想定の
// `selectPaidAndCheckKyc` は `#paid` が無いと false を返し、呼出側はそれを
// 「KYC で止まっていない」と読んで素通りしていた。実際の有料選択は
// 公開設定画面にあるので、その DOM を確定させる。
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

const accountId = process.argv[2];
const noteId = process.argv[3];
if (!accountId || !noteId) {
  console.log('usage: note-paid-type-recon.sh <note_account_id> <note_id>');
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('select id, display_name, session_state_enc from note_accounts where id=$1', [
  accountId,
]);
await c.end();
const acc = r.rows[0];
if (!acc?.session_state_enc) {
  console.log('no session');
  process.exit(1);
}
const state = JSON.parse(dec(acc.session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  storageState: state,
  locale: 'ja-JP',
  viewport: { width: 1500, height: 1200 },
});
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

await page.goto(`https://editor.note.com/notes/${noteId}/edit/`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForTimeout(8000);
console.log('editor url:', page.url());

// エディタ側に #paid が居るのかをまず確定させる (現行コードの前提の検証)。
const inEditor = await page.evaluate(() => ({
  paid: !!document.querySelector('#paid'),
  radios: [...document.querySelectorAll('input[type=radio]')].map((e) => e.id || e.name || '?'),
}));
console.log('--- エディタ側 ---');
console.log(JSON.stringify(inEditor));

// React は合成イベントを使うので dispatchEvent では拾われないことがある。実クリックにする。
let clicked = false;
for (const sel of ['button:has-text("公開に進む")', 'text=公開に進む']) {
  const loc = page.locator(sel).first();
  if (await loc.count().catch(() => 0)) {
    await loc.click({ timeout: 10000 }).catch(() => {});
    clicked = true;
    break;
  }
}
console.log('公開に進む clicked:', clicked);
await page.waitForSelector('text=記事タイプ', { timeout: 20000 }).catch(() => console.log('「記事タイプ」が出ない'));
await page.waitForTimeout(3000);
console.log('settings url:', page.url());

const dump = () =>
  page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[type=radio],[role=radio]')].map((e) => {
      const lbl = e.closest('label');
      return {
        tag: e.tagName,
        id: e.id,
        name: e.getAttribute('name'),
        value: e.getAttribute('value'),
        role: e.getAttribute('role'),
        ariaChecked: e.getAttribute('aria-checked'),
        checked: e.checked ?? null,
        disabled: e.disabled ?? null,
        labelText: (lbl?.textContent || e.textContent || '').trim().slice(0, 20),
      };
    });
    // 「無料」「有料」そのものを持つ要素も拾う (独自実装のラジオ対策)。
    const typeEls = [...document.querySelectorAll('label,div,span,button')]
      .filter((e) => ['無料', '有料'].includes((e.textContent || '').trim()))
      .map((e) => ({
        tag: e.tagName,
        id: e.id,
        cls: (e.className || '').toString().slice(0, 70),
        role: e.getAttribute('role'),
        forAttr: e.getAttribute('for'),
        text: (e.textContent || '').trim(),
        hasRadioInside: !!e.querySelector('input'),
        innerInputId: e.querySelector('input')?.id ?? null,
      }));
    const inputs = [...document.querySelectorAll('input:not([type=radio]),textarea,select')].map(
      (e) => ({
        tag: e.tagName,
        type: e.getAttribute('type'),
        name: e.getAttribute('name'),
        id: e.id,
        ph: e.getAttribute('placeholder'),
        aria: e.getAttribute('aria-label'),
        val: (e.value || '').slice(0, 20),
      }),
    );
    return { radios, typeEls, inputs };
  });

console.log('--- 公開設定 (有料を選ぶ前) ---');
console.log(JSON.stringify(await dump(), null, 1));

// 「有料」を選ぶ。ラベルのテキストで探して、実ユーザーと同じくラベルをクリックする。
const selected = await page.evaluate(() => {
  const radio = [...document.querySelectorAll('input[type=radio]')].find((e) => {
    const lbl = e.closest('label');
    return (lbl?.textContent || '').trim() === '有料';
  });
  if (!radio) return { found: false };
  const lbl = radio.closest('label') ?? radio;
  const r = lbl.getBoundingClientRect();
  return { found: true, id: radio.id, name: radio.getAttribute('name'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('--- 有料ラジオ ---');
console.log(JSON.stringify(selected));
if (selected.found) {
  await page.mouse.click(selected.x, selected.y);
  await page.waitForTimeout(4000);
  console.log('--- 公開設定 (有料を選んだ後) ---');
  console.log(JSON.stringify(await dump(), null, 1));
  const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1500));
  console.log('--- body text ---');
  console.log(bodyText);
  await page
    .screenshot({ path: path.join(OUT, 'paid-type-selected.png'), fullPage: true })
    .catch(() => {});
}

await browser.close();
console.log('done (投稿はしていない)');
