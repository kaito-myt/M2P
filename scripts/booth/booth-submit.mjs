/**
 * BOOTH 半自動入稿 (方針B, F-096)。作品ファイル以外を全て自動入力し「下書きで保存」まで行う。
 * 運営者は後で「作品ファイル(EPUB/PDF)アップロード」+「公開で保存」の2操作のみ。
 *   bash scripts/paperback/pb-env.sh node scripts/booth/booth-submit.mjs <bookId>
 * 前提: scripts/bookwalker/out/<bookId>-cover.jpg 生成済み(商品画像に使用)。
 * セッション: app_settings.booth_session_state_enc。
 */
import { createRequire } from 'module';
import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const BOUT = path.join(REPO, 'scripts/booth/out'); fs.mkdirSync(BOUT, { recursive: true });
function dec(b64) { const raw = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }

const bookId = process.argv[2];
if (!bookId) { console.log('usage: booth-submit.mjs <bookId>'); process.exit(1); }
const cover = path.join(OUT, `${bookId}-cover.jpg`);

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(`SELECT b.title, b.subtitle, tc.genre,
   (SELECT description FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) description,
   (SELECT price_jpy FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) price,
   (SELECT keywords FROM kdp_metadata WHERE book_id=b.id ORDER BY created_at DESC LIMIT 1) keywords
 FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
const sess = await c.query("SELECT booth_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const { title, subtitle, description, price, keywords } = bq.rows[0];
const descText = String(description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const priceJpy = price || 500;
const kwArr = Array.isArray(keywords) ? keywords : (() => { try { return JSON.parse(keywords || '[]'); } catch { return []; } })();
const state = JSON.parse(dec(sess.rows[0].booth_session_state_enc));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(BOUT, `${bookId}-${n}.png`), fullPage: true }).catch(() => {});

// 1) 既存下書き再利用(BOOTH_ITEM_URL) or 新規「ダウンロード商品を登録」
const reuse = process.env.BOOTH_ITEM_URL;
if (reuse) {
  await page.goto(reuse, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (/signin|accounts\.pixiv/.test(page.url())) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
  console.log('既存下書き再利用:', page.url());
} else {
  await page.goto('https://manage.booth.pm/items/select_type', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  if (/signin|accounts\.pixiv/.test(page.url())) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
  await page.getByText('「ダウンロード」商品を登録', { exact: false }).first().click({ force: true }).catch((e) => console.log('登録click err', e.message.slice(0, 40)));
  await page.waitForTimeout(7000);
}
const itemUrl = page.url();
console.log('下書き作成:', itemUrl);

// 2) 商品名
const nameInput = page.getByLabel('商品名').first();
if (await nameInput.count().catch(() => 0)) { await nameInput.click().catch(() => {}); await nameInput.fill((title + (subtitle ? ' ' + subtitle : '')).slice(0, 60)).catch(() => {}); }
// 3) 商品紹介文(textarea)
const desc = page.locator('textarea.charcoal-text-area-textarea, textarea').first();
if (await desc.count().catch(() => 0)) { await desc.click().catch(() => {}); await desc.fill(descText.slice(0, 800)).catch(() => {}); }
// 4) 価格
const priceInput = page.locator('[name="price"]').first();
if (await priceInput.count().catch(() => 0)) { await priceInput.click().catch(() => {}); await priceInput.fill('').catch(() => {}); await priceInput.fill(String(priceJpy)).catch(() => {}); }
// 5) タグ(上位3件)
for (const kw of kwArr.slice(0, 3)) {
  const tag = page.getByPlaceholder('タグの追加').first();
  if (await tag.count().catch(() => 0)) { await tag.click().catch(() => {}); await tag.fill(String(kw).slice(0, 20)).catch(() => {}); await page.keyboard.press('Enter').catch(() => {}); await page.waitForTimeout(500); }
}
// 6) 年齢制限=全年齢
await page.evaluate(() => { const rs = [...document.querySelectorAll('input[name="adult"]')]; for (const r of rs) { const l = (r.closest('label')?.textContent || r.parentElement?.textContent || '').trim(); if (/全年齢/.test(l)) r.click(); } });
// 7) 代理購入サービスの掲載許可 = 許可する(accepted)で海外販売も可に
await page.evaluate(() => { const sels = [...document.querySelectorAll('select')]; for (const s of sels) { if ([...s.options].some((o) => o.value === 'accepted')) { s.value = 'accepted'; s.dispatchEvent(new Event('change', { bubbles: true })); } } });
// 8) カテゴリ選択(必須): モーダルで「小説・その他書籍」をネイティブlocatorクリック
await page.getByText('カテゴリを選択してください', { exact: false }).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(3500);
const catLoc = page.getByText('小説・その他書籍', { exact: false }).first();
await catLoc.click({ force: true, timeout: 6000 }).catch((e) => console.log('cat click err', e.message.slice(0, 40)));
await page.waitForTimeout(2500);
// サブ(小説/評論・情報 等)があればクリック、無ければそのまま
await page.getByText(/^(小説|評論・情報|その他書籍|テキスト)$/).first().click({ force: true, timeout: 4000 }).catch(() => {});
await page.waitForTimeout(1500);
// 決定/選択ボタン(モーダルに確定ボタンがあれば)
await page.getByRole('button', { name: /決定|選択する|確定|完了|この分類/ }).first().click({ force: true, timeout: 3000 }).catch(() => {});
await page.waitForTimeout(1500);
const catDone = await page.evaluate(() => !/公開するには「カテゴリ」を選択してください/.test(document.body.innerText || ''));
console.log('カテゴリ選択:', catDone ? 'OK(エラー消失)' : '未完了');

// 9) 商品画像: まずドロップゾーンのクリックで filechooser を誘発(隠しinput経由)を試す
if (fs.existsSync(cover)) {
  const imgZone = page.getByText(/画像ファイルをドラッグ|ドラッグ&ドロップ|ドラッグ＆ドロップ/).first();
  let imgOk = false;
  if (await imgZone.count().catch(() => 0)) {
    try { const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), imgZone.click({ force: true })]); await fc.setFiles(cover); imgOk = true; console.log('商品画像: filechooserで投入'); }
    catch { /* filechooser出ず→DataTransferへ */ }
  }
  if (imgOk) { await page.waitForTimeout(4000); }
}
// 9b) filechooserがダメならDataTransferドロップ
if (fs.existsSync(cover) && !(await page.evaluate(() => !!document.querySelector('img[src*="booth"],img[src*="pximg"],[class*=preview] img')).catch(() => false))) {
  const buf = fs.readFileSync(cover);
  const b64 = buf.toString('base64');
  const dropped = await page.evaluate(async ({ b64 }) => {
    const zone = [...document.querySelectorAll('*')].find((e) => /画像ファイルをドラッグ|ドラッグ&ドロップ|ドラッグ＆ドロップ/.test(e.textContent || '') && e.offsetParent !== null);
    if (!zone) return 'no-zone';
    const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'cover.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); zone.dispatchEvent(ev); }
    return 'dropped';
  }, { b64 }).catch((e) => 'err:' + e.message.slice(0, 30));
  console.log('商品画像ドロップ:', dropped);
  await page.waitForTimeout(4000);
}

await shot('filled');
// 10) 下書きで保存する
await page.getByText('下書きで保存する', { exact: false }).first().click({ force: true, noWaitAfter: true }).catch((e) => console.log('保存click err', e.message.slice(0, 40)));
await page.waitForTimeout(6000);
await shot('saved');
const savedUrl = page.url();
console.log('BOOTH下書き保存完了:', savedUrl);
console.log('→ 運営者作業: 作品ファイル(EPUB/PDF)をアップロード後「公開で保存する」');
await browser.close();

// DB書き戻し: booth_publish_status='draft_ready' + 下書きURLを記録
try {
  const c2 = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c2.connect();
  await c2.query(`UPDATE books SET booth_publish_status='draft_ready', booth_submitted_at=now() WHERE id=$1`, [bookId]);
  await c2.end();
} catch (e) { console.log('DB書戻しskip:', e.message.slice(0, 40)); }
console.log('PAIR ' + bookId + ' ' + savedUrl);
process.exit(0);
