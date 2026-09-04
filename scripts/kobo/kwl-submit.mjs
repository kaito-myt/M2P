/**
 * 楽天Kobo (KWL) 入稿 (1冊)。既定は dry-run(基本情報+ファイル入力→下書き保存、出版はしない)。
 *   bash scripts/paperback/pb-env.sh 相当のenv(DBURL,KDP_CRED_KEY,R2_*) + node kwl-submit.mjs <bookId> [--submit]
 * 前提: scripts/bookwalker/out/<bookId>.epub と <bookId>-cover.jpg が生成済み(build-epub / bw-cover-jpg 流用)。
 * セッションは app_settings.kobo_session_state_enc(DB, 暗号化)を再利用。
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
const KOUT = path.join(REPO, 'scripts/kobo/out'); fs.mkdirSync(KOUT, { recursive: true });

const bookId = process.argv[2];
const SUBMIT = process.argv.includes('--submit');
if (!bookId) { console.log('usage: kwl-submit.mjs <bookId> [--submit]'); process.exit(1); }
const epub = path.join(OUT, `${bookId}.epub`), cover = path.join(OUT, `${bookId}-cover.jpg`);
for (const f of [epub, cover]) if (!fs.existsSync(f)) { console.log('必要ファイル無し:', path.basename(f)); process.exit(3); }

function dec(b64) { const raw = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const bq = await c.query(`SELECT b.title, b.subtitle, tc.genre,
   (SELECT km.description FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) description,
   (SELECT km.price_jpy FROM kdp_metadata km WHERE km.book_id=b.id ORDER BY created_at DESC LIMIT 1) price_jpy,
   (SELECT acc.pen_name FROM accounts acc WHERE acc.id=b.account_id) pen_name
 FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id WHERE b.id=$1`, [bookId]);
const sess = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
if (!bq.rows.length) { console.log('book not found'); process.exit(1); }
const { title, subtitle, genre, description, price_jpy, pen_name } = bq.rows[0];
const author = pen_name || '宮田海斗';
const priceJpy = price_jpy || 500;
const descText = String(description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const state = JSON.parse(dec(sess.rows[0].kobo_session_state_enc));

const HEADFUL = process.env.HEADFUL === '1';
const browser = await chromium.launch({ headless: !HEADFUL, ...(HEADFUL ? { channel: 'chrome' } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
await ctx.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
ctx.setDefaultTimeout(60000);
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(KOUT, `kwl-${n}.png`), fullPage: true }).catch(() => {});
const responses = [];
page.on('response', (r) => { const m = r.request().method(); const u = r.url(); if (m !== 'GET' && /kobo\.com/.test(u) && !/\.(js|css|png|jpg|gif|woff)|collect|analytics/.test(u)) responses.push(`${m} ${r.status()} ${u.replace(/https?:\/\/[^/]+/, '').slice(0, 55)}`); });

// KWL_TARGET_ID 指定時は既存商品(作成中の重複等)を開いて別作品で上書きする(削除不可のため再利用)。
const TARGET_ID = process.env.KWL_TARGET_ID || '';
const startUrl = TARGET_ID
  ? `https://rakutenkwl.kobo.com/v2/ebooks/ebook/${TARGET_ID}`
  : 'https://rakutenkwl.kobo.com/v2/ebooks/ebook/';
await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(TARGET_ID ? 11000 : 9000);
if (/signin|authorize\.kobo/.test(page.url())) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
if (TARGET_ID) console.log('上書きモード: 既存商品', TARGET_ID.slice(0, 8), 'を', title.slice(0, 20), 'で上書き');

// --- テキスト欄(name属性で特定): 上書きモードでは既存値をクリアしてから入れる ---
const fill = async (name, v) => { if (v == null || v === '') return; const e = await page.$(`[name="${name}"]`); if (e) { await e.click().catch(() => {}); await e.fill('').catch(() => {}); await e.fill(String(v)).catch(() => {}); } };
await fill('metadata.title', title);
await fill('metadata.subtitle', subtitle || '');
await fill('metadata.contributors[0].name', author);
await fill('metadata.publisher', author);
// 著者の役割(contributors[0].type=hidden必須): 可視の役割ドロップダウンで「著者」を選ぶ。
{
  // 名前欄の近傍にある役割セレクト/コンボを開く
  const roleCombo = page.locator('button,[role=combobox],[role=button],select').filter({ hasText: /役割|貢献者|種別|著者|選択してください|Contributor|Role/ }).first();
  let done = false;
  if (await roleCombo.count().catch(() => 0)) {
    await roleCombo.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    const opt = page.locator('[role=option],li,option').filter({ hasText: /^著者$|著者（|^著$/ }).first();
    if (await opt.count().catch(() => 0)) { await opt.click({ force: true }).catch(() => {}); done = true; }
  }
  // フォールバック: 隠しinputにReact互換イベントで値を投入(候補: Author / 著者)
  const hv = await page.evaluate((val) => {
    const el = document.querySelector('[name="metadata.contributors[0].type"]');
    if (!el) return 'no-el';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, 'Author').catch(() => 'err');
  console.log('著者役割: combo=' + done + ' hidden=' + hv);
}
// 内容紹介(Quillリッチテキストエディタ .ql-editor)
{
  const ed = page.locator('.ql-editor').first();
  if (await ed.count().catch(() => 0)) {
    await ed.click().catch(() => {});
    // 上書きモード: 既存本文を全削除
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.keyboard.type(descText.slice(0, 3000).replace(/\n{2,}/g, '\n'), { delay: 2 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}
// 言語=日本語 (react-aria カスタムセレクト: ボタン→リストで選ぶ。selectOptionはReact状態に効かない)
{
  const langBtn = page.locator('button,[role=combobox],[role=button]').filter({ hasText: /言語をご選択|言語を選択|Select language/ }).first();
  if (await langBtn.count().catch(() => 0)) {
    await langBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator('[role=option],[role=listbox] li,li').filter({ hasText: /^日本語$/ }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1000);
  } else {
    await page.selectOption('[name="metadata.language"]', { label: '日本語' }).catch(() => {});
  }
}
// パブリックドメイン=いいえ / 全世界権利=はい (ラジオ: 値でなくラベルテキストの隣を選ぶ)
const pickRadio = async (groupName, wantLabel) => {
  await page.evaluate(({ groupName, wantLabel }) => {
    const radios = [...document.querySelectorAll(`input[type=radio][name="${groupName}"]`)];
    for (const r of radios) { const lbl = (r.closest('label')?.textContent || (r.id && document.querySelector(`label[for="${r.id}"]`)?.textContent) || r.parentElement?.textContent || '').replace(/\s+/g, ' ').trim(); if (lbl.includes(wantLabel)) { r.click(); return true; } }
    return false;
  }, { groupName, wantLabel }).catch(() => {});
};
await pickRadio('metadata.publicDomainContent', 'いいえ');
await pickRadio('ownWorldwideRights', 'はい');
console.log('基本情報入力完了:', title.slice(0, 24), 'author=', author);

// ジャンル選択は後段(ファイルアップロードの再描画でリセットされるため、アップロード後に行う)。
// KWL のジャンルは「トップカテゴリをクリックで展開(⌄)→ チェックボックス『一般』をチェック」で選ぶ。
const genreTop = (() => {
  const g = (genre || '').toLowerCase();
  if (/money|invest|business|side_business|finance|経済|投資|副業|ビジネス/.test(g)) return 'ビジネス・経済・就職';
  if (/health|beauty|cooking|food|lifestyle|美容|健康|料理|暮らし/.test(g)) return '美容・暮らし・健康・料理';
  if (/study|language|education|学習|語学|資格/.test(g)) return '語学・学習参考書・資格';
  if (/self_help|自己啓発|人文|思想|社会/.test(g)) return '人文・思想・社会';
  if (/novel|fiction|essay|literature|小説|エッセイ|文芸/.test(g)) return '小説・エッセイ';
  if (/light_novel|ラノベ|entertainment/.test(g)) return 'エンターテインメント';
  if (/hobby|sport|art|趣味|スポーツ|美術/.test(g)) return 'ホビー・スポーツ・美術';
  return 'ノンフィクション';
})();

// --- ファイル(accept属性で表紙/EPUBを判別) ---
const fileInputs = await page.$$('input[type=file]');
for (const fi of fileInputs) {
  const accept = (await fi.getAttribute('accept')) || '';
  if (/image|jpe?g|png/.test(accept)) await fi.setInputFiles(cover).catch((e) => console.log('cover err', e.message.slice(0, 40)));
  else if (/epub/.test(accept)) await fi.setInputFiles(epub).catch((e) => console.log('epub err', e.message.slice(0, 40)));
}
console.log('表紙+EPUB入力完了 — アップロード処理待ち');
await page.waitForTimeout(25000);

// --- ジャンル(必須): トップカテゴリを展開→「一般」チェックボックスをチェック ---
{
  const selectGenre = async (topName) => {
    // トップカテゴリをクリックして展開
    await page.getByText(new RegExp('^' + topName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[›⌄]?\\s*$')).first().click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // 展開領域に現れた「一般」チェックボックスをチェック(未チェックのもの)
    const checked = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter((b) => b.offsetParent !== null && !b.checked);
      for (const b of boxes) {
        const lbl = (b.closest('label')?.textContent || (b.id && document.querySelector(`label[for="${b.id}"]`)?.textContent) || b.parentElement?.textContent || '').replace(/\s+/g, ' ').trim();
        if (/一般/.test(lbl)) { b.click(); return lbl.slice(0, 20); }
      }
      return null;
    });
    return checked;
  };
  let picked = await selectGenre(genreTop);
  if (!picked) picked = await selectGenre('ノンフィクション');
  await page.waitForTimeout(1500);
  // 検証: ジャンルエラー文が本文に残っていないか(分割ノード対策で innerText 全体で判定)
  const stillErr = await page.evaluate(() => /①[^。]*ジャンル|ジャンルを\s*1\s*つ以上ご選択ください/.test(document.body.innerText || ''));
  console.log('ジャンル選択:', genreTop, '→', picked, 'エラー残:', stillErr);
}
await shot('filled');

// --- 価格(JPY): react-aria 制御のためクリック→全選択→キーボード入力で React 状態に登録 ---
{
  const pe = page.locator('[name="prices[0]"]').first();
  if (await pe.count().catch(() => 0)) {
    await pe.click({ clickCount: 3 }).catch(() => {}); // triple-click で既存値を全選択
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.type(String(priceJpy), { delay: 30 }).catch(() => {});
    await page.keyboard.press('Tab').catch(() => {});
    await page.waitForTimeout(1200);
  }
  const pv = await page.evaluate(() => document.querySelector('[name="prices[0]"]')?.value);
  console.log('価格入力: ¥' + priceJpy, '(field=' + pv + ')');
}
console.log('POSTs:', JSON.stringify(responses.slice(-8)));

if (SUBMIT) {
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 60)); await d.accept().catch(() => {}); });
  // 1) 保存でサーバーに確定(著者役割type等がサーバー側デフォルトで埋まる)
  console.log('--- 保存 ---');
  await page.locator('button').filter({ hasText: /^保存$/ }).first().click({ force: true, noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(9000);
  const draftUrl = page.url();
  console.log('保存後URL:', draftUrl);
  // 2) ドラフトをハードリロード — フォーム(react-hook-form)がサーバー保存データ(著者役割type含む)を
  //    完全に再初期化し client 検証が通る(人間が保存済み下書きを新規に開いて出版できるのと同じ状態)。
  if (/\/ebooks\/ebook\/[0-9a-f-]{20,}/.test(draftUrl)) {
    // 商品fetch APIのレスポンスを待ってから続行
    const prodFetch = page.waitForResponse((r) => /\/product\//.test(r.url()) && r.request().method() === 'GET', { timeout: 25000 }).catch(() => null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await prodFetch;
    // タイトルが再表示されるまで最大30秒待つ
    let ok = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      const t = await page.evaluate(() => document.querySelector('[name="metadata.title"]')?.value || '');
      if (t && t.length > 1) { console.log('ハードリロード完了 title=' + t.slice(0, 18) + ' (' + (i * 2) + 's)'); ok = true; break; }
    }
    if (!ok) console.log('リロード後タイトル未再表示');
    await page.waitForTimeout(4000);
  }
  console.log('--- 出版する クリック ---');
  const prodId = (page.url().match(/ebook\/([0-9a-f-]{20,})/) || [])[1];
  const getStatus = () => page.evaluate(async (id) => { try { const r = await fetch('/product/' + id + '?productType=BOOK', { headers: { accept: 'application/json' } }); return (await r.json()).status; } catch (e) { return 'ERR'; } }, prodId);
  const clickPublish = async () => {
    const pubBtn = page.locator('button').filter({ hasText: /^出版する$/ }).first();
    await pubBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    const box = await pubBtn.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await pubBtn.click({ force: true, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(4000);
    // 確認モーダルがあれば確定
    const modal = page.locator('[role=dialog] button,[class*=modal] button,[class*=Modal] button').filter({ hasText: /出版|確定|はい|OK|続行|公開/ }).first();
    if (await modal.count().catch(() => 0)) { const cb = await modal.boundingBox().catch(() => null); if (cb) await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.waitForTimeout(4000); }
  };
  // 出版クリック → API でステータス確認 → PUBLISH_REQUESTED になるまで最大4回リトライ。
  // (「必須項目です」等のUI誤検知が出ても実サーバー状態が遷移すれば成功)
  let finalStatus = await getStatus();
  for (let attempt = 0; attempt < 4 && !/PUBLISH_REQUESTED|ANALYZE|PUBLISHED|REVIEW/i.test(finalStatus); attempt++) {
    await clickPublish();
    finalStatus = await getStatus();
    console.log(`出版試行${attempt + 1}: status=${finalStatus}`);
    if (/PUBLISH_REQUESTED|ANALYZE|PUBLISHED|REVIEW/i.test(finalStatus)) break;
    // 再試行前に表紙が外れていれば再投入(リロードで client 状態が落ちるため)
    const coverMissing = await page.evaluate(() => /表紙画像 は必須/.test(document.body.innerText || ''));
    if (coverMissing) { const fis = await page.$$('input[type=file]'); for (const fi of fis) { const a = (await fi.getAttribute('accept')) || ''; if (/image|jpe?g|png/.test(a)) await fi.setInputFiles(cover).catch(() => {}); } await page.waitForTimeout(10000); }
  }
  await shot('submitted');
  console.log('PB RESULT:', /PUBLISH_REQUESTED|ANALYZE|PUBLISHED|REVIEW/i.test(finalStatus) ? 'KOBO_SUBMITTED status=' + finalStatus : 'KOBO_FAILED status=' + finalStatus);
} else {
  console.log('--- DRY-RUN: 保存(下書き) ---');
  await page.locator('button').filter({ hasText: /^保存$/ }).first().click({ force: true, noWaitAfter: true, timeout: 10000 }).then(() => console.log('保存click')).catch((e) => console.log('保存click err', e.message.slice(0, 50)));
  await page.waitForTimeout(6000);
  await shot('saved');
  console.log('保存後POST:', JSON.stringify(responses.slice(-6)));
  console.log('URL:', page.url());
}
await browser.close();
process.exit(0);
