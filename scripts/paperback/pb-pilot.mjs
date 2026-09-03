/**
 * ペーパーバック パイロット (dry-run): STEP1→STEP2(判型/用紙/ファイルアップロード)→STEP3(価格)まで進み、
 * **「出版」は絶対にクリックしない**(下書き止まり)。各段でフォームダンプ+スクショを出力し、
 * 作成制限モーダル(本の作成数制限)が出たら即記録して終了する。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-pilot.mjs <bookId> <ASIN>
 * 前提: scripts/paperback/out/<bookId>-pb-cover.pdf が生成済み。原稿はR2 final.pdf をDL。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const { S3Client, GetObjectCommand } = reqRoot(path.join(REPO, 'node_modules/.pnpm/@aws-sdk+client-s3@3.1051.0/node_modules/@aws-sdk/client-s3'));
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');

const bookId = process.argv[2];
const asin = process.argv[3];
if (!bookId || !asin) { console.log('usage: pb-pilot.mjs <bookId> <ASIN>'); process.exit(1); }
const coverPdf = path.join(OUT, `${bookId}-pb-cover.pdf`);
if (!fs.existsSync(coverPdf)) { console.log('cover pdf がない:', coverPdf); process.exit(1); }

// 原稿PDF: 316頁以上専用の pb-interior があればそれ、無ければ R2 final.pdf
let interiorPdf = path.join(OUT, `${bookId}-pb-interior.pdf`);
if (!fs.existsSync(interiorPdf)) {
  interiorPdf = path.join(OUT, `${bookId}-interior.pdf`);
  if (!fs.existsSync(interiorPdf)) {
    const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: `books/${bookId}/manuscript/final.pdf` }));
    const cs = []; for await (const c of res.Body) cs.push(c);
    fs.writeFileSync(interiorPdf, Buffer.concat(cs));
    console.log('原稿DL:', Math.round(Buffer.concat(cs).length / 1024) + 'KB');
  }
}

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'],
});
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `pilot-${n}.png`), fullPage: true }).catch(() => {});

async function bodyHas(re) { return await page.evaluate((s) => new RegExp(s).test(document.body.textContent || ''), re.source).catch(() => false); }

// Kindleウィザードと同じ max_auth_age 再認証ウォール(/ap/signin)をパスワード実タイプ+TOTPで通す
async function passReauthIfNeeded(label) {
  if (!/\/ap\/signin/.test(page.url())) return true;
  console.log(`再認証ウォール検知(${label}) — パスワード実タイプで通過試行`);
  try {
    const pwd = process.env.AMAZON_PASSWORD;
    if (!pwd) { console.log('AMAZON_PASSWORD未設定 — 再認証不可'); return false; }
    const pf = await page.waitForSelector('#ap_password', { timeout: 20000 });
    await pf.click(); await pf.fill('');
    await pf.type(pwd, { delay: 35 });
    await page.check('#auth-remember-me').catch(() => {});
    await page.click('#signInSubmit');
    await page.waitForTimeout(9000);
    const otp = await page.$('#auth-mfa-otpcode');
    if (otp) {
      const sec = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
      if (!sec) { console.log('OTP要求だがAMAZON_TOTP_SECRET未設定'); return false; }
      const { authenticator } = req('otplib');
      await otp.type(authenticator.generate(sec), { delay: 35 });
      await page.check('#auth-mfa-remember-device').catch(() => {});
      await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter'));
      await page.waitForTimeout(9000);
      console.log('TOTP送信済み');
    }
    console.log('再認証後URL:', page.url().slice(0, 90));
    return !/\/ap\/signin/.test(page.url());
  } catch (e) { console.log('再認証失敗:', e.message.slice(0, 90)); return false; }
}

async function dump(label) {
  const info = await page.evaluate(() => {
    const els = [];
    for (const el of document.querySelectorAll('input,select,textarea,[role=radio],[role=checkbox],button')) {
      const lab = el.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || '';
      const t = { tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', id: el.id || '', name: el.getAttribute('name') || '', label: lab.slice(0, 70), value: el.type === 'password' ? '***' : (el.value || '').slice(0, 40), checked: el.checked ?? el.getAttribute('aria-checked') ?? '', text: (el.tagName === 'BUTTON' ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) : ''), visible: !!(el.offsetWidth || el.offsetHeight) };
      if (t.id || t.name || t.label || t.text) els.push(t);
    }
    return { url: location.href, els };
  });
  console.log(`\n===== DUMP ${label} ===== ${info.url}`);
  for (const e of info.els.filter((x) => x.visible)) console.log(JSON.stringify(e));
  await shot(label);
}

async function checkLimit(label) {
  // 可視のリーフ要素に限定して判定(隠しテンプレ文言の誤検知防止 — 2026-09-02 実測)
  const visibleHit = await page.evaluate(() =>
    [...document.querySelectorAll('*')].some((el) =>
      (el.offsetWidth || el.offsetHeight) && el.children.length === 0 &&
      /本の作成数制限|提出可能な本の数を超え/.test(el.textContent || '')));
  if (visibleHit) {
    console.log(`!!! CREATION_LIMIT at ${label}`);
    await shot(`limit-${label}`);
    await ctx.close(); process.exit(4);
  }
}

// --- STEP0: 本棚 → ペーパーバックの作成 (第4引数で既存下書きtitleId指定時はスキップして再開) ---
const RESUME_TITLE_ID = process.argv[4] || null;
if (!RESUME_TITLE_ID) {
await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
if (/signin/i.test(page.url())) { console.log('NOT_LOGGED_IN'); await ctx.close(); process.exit(2); }
const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
if (sb) { await sb.fill(asin); await page.keyboard.press('Enter'); await page.waitForTimeout(5000); }
const clicked = await page.evaluate((asin) => {
  const cands = [...document.querySelectorAll('a,button,span[role=button]')].filter((el) => /ペーパーバックの作成/.test(el.textContent || ''));
  for (const el of cands) { let row = el; for (let i = 0; i < 14 && row; i++) { row = row.parentElement; if ((row?.textContent || '').includes(asin)) break; } if ((row?.textContent || '').includes(asin) || cands.length === 1) { el.click(); return true; } }
  // ASIN行が特定できない場合は押さない(先頭行フォールバックは他書籍のPBを作る事故になるため廃止 2026-09-03)
  return false;
}, asin);
console.log('作成クリック:', clicked);
if (!clicked) { await dump('no-button'); await ctx.close(); process.exit(3); }
await page.waitForTimeout(9000);
await checkLimit('step1-open');

// --- STEP1a: カテゴリー(必須・Kindleから引き継がれない)。kdp_metadataのKindleカテゴリを流用 ---
const { Client: PgClient } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const dbc = new PgClient({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await dbc.connect();
const kmq = await dbc.query('SELECT categories FROM kdp_metadata WHERE book_id=$1 ORDER BY created_at DESC LIMIT 1', [bookId]);
await dbc.end();
let catPaths = kmq.rows[0]?.categories || [];
if (typeof catPaths === 'string') { try { catPaths = JSON.parse(catPaths); } catch { catPaths = []; } }
// Kindleパスは「Kindle本 > サブ > …」。ペーパーバックの木は根が違うので Kindle本 以降のセグメントを流用
const segLists = catPaths.slice(0, 3).map((p) => {
  const segs = String(p).split('>').map((s) => s.trim()).filter(Boolean);
  const i = segs.findIndex((x) => x.replace(/\s/g, '') === 'Kindle本');
  return i >= 0 ? segs.slice(i + 1) : segs;
}).filter((l) => l.length);
console.log('カテゴリ流用元:', JSON.stringify(segLists));
// ペーパーバックのカテゴリ木は紙書籍の独自分類(トップ=「暮らし・健康・子育て」等)。Kindleトップとの対応表+ファジー一致。
const PB_TOP_MAP = {
  '健康・フィットネス': '暮らし・健康・子育て', '自己啓発': '人文・思想', 'ビジネス・経済': 'ビジネス・経済',
  '投資・金融': '投資・金融・会社経営', '文学・評論': '文学・評論', 'ライトノベル': 'コミック・ラノベ・BL',
  '趣味・実用': '趣味・実用', 'スポーツ': 'スポーツ・アウトドア', '教育・学参': '教育・学参・受験',
};
const catBtn = await page.$('#categories-modal-button');
if (catBtn) {
  await catBtn.click(); await page.waitForTimeout(3500);
  // モーダル内スコープ(ページ側のLCB/大活字チェックを誤爆しない)
  const SCOPE = '[role=dialog], .a-popover:not([style*="display: none"]), .a-modal-scroller';
  const fuzzyPick = async (seg) => {
    // 可視selectのうち「1 つ選択」状態 or seg に一致し得るものへファジー選択
    for (let a = 0; a < 4; a++) {
      const res = await page.evaluate(({ SCOPE, seg }) => {
        const dlg = document.querySelector(SCOPE.split(',')[0].trim()) || document.querySelector('.a-popover:not([style*="display: none"])') || document.querySelector('.a-modal-scroller');
        if (!dlg) return { err: 'no-dialog' };
        const sels = [...dlg.querySelectorAll('select')].filter((s) => s.offsetWidth || s.offsetHeight);
        const score = (opt) => {
          const t = opt.trim(); if (!t || /^1 つ選択/.test(t)) return -1;
          if (t === seg) return 100;
          if (t.includes(seg) || seg.includes(t)) return 80;
          let ov = 0; for (const ch of new Set(seg)) if (t.includes(ch)) ov++;
          return ov / Math.max(3, seg.length) * 60;
        };
        for (const s of sels) {
          const cur = s.options[s.selectedIndex]?.textContent.trim() || '';
          if (cur && !/^1 つ選択/.test(cur)) continue; // 既に選択済みのselectは飛ばす
          let best = null;
          for (const o of s.options) { const sc = score(o.textContent); if (sc > 20 && (!best || sc > best.sc)) best = { sc, label: o.textContent.trim(), value: o.value }; }
          if (best) { s.value = best.value; s.dispatchEvent(new Event('change', { bubbles: true })); return { picked: best.label, sc: Math.round(best.sc) }; }
          return { err: 'no-option-for:' + seg };
        }
        return { err: 'no-open-select' };
      }, { SCOPE, seg });
      if (res.picked) { await page.waitForTimeout(1800); return res; }
      if (res.err === 'no-open-select' || res.err?.startsWith('no-option')) return res;
      await page.waitForTimeout(900);
    }
    return { err: 'timeout' };
  };
  const checkLeafInModal = () => page.evaluate((SCOPE) => {
    const dlg = document.querySelector(SCOPE.split(',')[0].trim()) || document.querySelector('.a-popover:not([style*="display: none"])') || document.querySelector('.a-modal-scroller');
    if (!dlg) return { ok: false, err: 'no-dialog' };
    const boxes = [...dlg.querySelectorAll('input[type=checkbox]')].filter((c) => (c.offsetWidth || c.offsetHeight) && !c.checked);
    const lbl = (c) => (c.closest('label')?.textContent || (c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!boxes.length) return { ok: false, err: 'no-checkbox' };
    boxes[0].click(); return { ok: true, picked: lbl(boxes[0]) };
  }, SCOPE);
  const lists = segLists.length ? segLists : [['趣味・実用']];
  for (let ci = 0; ci < lists.length; ci++) {
    if (ci > 0) { await page.click('button:has-text("別のカテゴリーを追加")').catch(() => {}); await page.waitForTimeout(2000); }
    const raw = lists[ci];
    const mapped = [PB_TOP_MAP[raw[0]] || raw[0], ...raw.slice(1)];
    console.log(`  カテゴリ${ci + 1} 目標:`, JSON.stringify(mapped));
    for (const seg of mapped) {
      const r = await fuzzyPick(seg);
      console.log(`    seg「${seg}」→`, JSON.stringify(r));
      if (r.err === 'no-open-select') break; // 全select選択済み=葉orチェック段階
    }
    // 追加で開いたselectが残っていれば適当に降りる(最大3段)
    for (let d = 0; d < 3; d++) { const r = await fuzzyPick(mapped[mapped.length - 1]); if (!r.picked) break; console.log('    追降下→', JSON.stringify(r)); }
    const leaf = await checkLeafInModal();
    console.log(`  カテゴリ${ci + 1} leaf:`, JSON.stringify(leaf));
    await page.waitForTimeout(1200);
  }
  const saved = await page.evaluate((SCOPE) => {
    const dlg = document.querySelector(SCOPE.split(',')[0].trim()) || document.querySelector('.a-popover:not([style*="display: none"])');
    const cnt = (dlg?.textContent.match(/(\d+) 個のカテゴリーを選択済み/) || [])[1];
    const b = [...(dlg || document).querySelectorAll('button')].find((x) => /カテゴリーを保存/.test(x.textContent || ''));
    if (b) b.click();
    return cnt || '?';
  }, SCOPE);
  console.log(`カテゴリー保存済み (選択数=${saved})`);
  await page.waitForTimeout(3000);
}

// --- STEP1: 「保存して続行」 ---
console.log('STEP1: 保存して続行...');
await page.click('#save-and-continue-announce').catch(async (e) => { console.log('continueクリック失敗:', e.message.slice(0, 80)); await dump('step1-fail'); });
await page.waitForTimeout(12000);
await checkLimit('step1-continue');
// エラーバナー(カテゴリー未設定等)が出て details に留まったら診断ダンプ
if (/\/details/.test(page.url())) {
  // 可視のエラーバナーのみ(不可視テンプレの placeholder 文言を除外)
  const err = await page.evaluate(() => [...document.querySelectorAll('.a-alert-error,.a-box-inner .a-alert-container')]
    .filter((x) => x.offsetParent !== null)
    .map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 200))
    .filter((t) => t && !/placeholder/.test(t)));
  if (err.length) { console.log('STEP1 エラー:', JSON.stringify(err)); await dump('step1-error'); await ctx.close(); process.exit(5); }
  await page.waitForTimeout(8000);
}
console.log('URL:', page.url());
await passReauthIfNeeded('step1続行後');
} else {
  // 既存下書き再開: content ページへ直行
  await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${RESUME_TITLE_ID}/content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  await passReauthIfNeeded('resume直行');
  if (!/print-setup/.test(page.url())) {
    await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${RESUME_TITLE_ID}/content`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
  }
  console.log('RESUME URL:', page.url());
}

// --- STEP2: 印刷オプション+アップロード。まず現状ダンプ(セレクタ採取) ---
await dump('step2-initial');

// ISBN: 無料KDP ISBNを取得(ボタンがあれば)
const isbnBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, input[type=button]')].find((x) => /無料.*ISBN|ISBN.*取得/.test((x.textContent || x.value || '')));
  if (b) { b.click(); return (b.textContent || b.value || '').trim().slice(0, 40); } return null;
});
if (isbnBtn) {
  console.log('ISBNボタン:', isbnBtn); await page.waitForTimeout(4000);
  // ダイアログが開く(overlayが以降のクリックを遮断する)。ダイアログ内ボタンを実クリックで処理。
  const dlgInfo = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role=dialog], [aria-modal="true"]')].find((d) => d.offsetWidth || d.offsetHeight);
    if (!dlg) return { open: false };
    return { open: true, text: dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 250), buttons: [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean) };
  });
  console.log('ISBNダイアログ:', JSON.stringify(dlgInfo));
  if (dlgInfo.open) {
    const btnSel = page.locator('[role=dialog] button, [aria-modal="true"] button').filter({ hasText: /割り当て|取得|確認|はい|OK/ }).first();
    await btnSel.click({ timeout: 10000 }).catch(async (e) => { console.log('ISBNダイアログボタン失敗:', e.message.slice(0, 60)); await page.keyboard.press('Escape').catch(() => {}); });
    await page.waitForTimeout(5000);
  }
  // overlay残骸をEscapeで掃除
  for (let k = 0; k < 2; k++) {
    const still = await page.evaluate(() => !![...document.querySelectorAll('[role=dialog], [aria-modal="true"]')].find((d) => d.offsetWidth || d.offsetHeight));
    if (!still) break;
    await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(1500);
  }
  const isbnNow = await page.evaluate(() => (document.body.textContent.match(/97[89][-\d]{10,14}/) || [null])[0]);
  console.log('割当ISBN:', isbnNow || '(未検出)');
}

// 印刷オプション: run5実測で既定値が全て正解(BW_WHITE/裁ち落としなし/MATTE/左→右)。明示的に担保。
for (const sel of ['#ink-paper-BW_WHITE', '#bleed-no', '#cover-finish-MATTE', '#page-turn-direction-left-to-right']) {
  await page.check(sel, { force: true }).catch(() => {});
}
console.log('印刷オプション: BW_WHITE / no-bleed / MATTE / LTR');

// 判型 148x210 (A5): 判型UIは role=button の可能性 — 広く探して開きダンプ→A5選択
const trimBtnFound = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('button,[role=button],a')].filter((x) => /判型/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight));
  if (cands[0]) { cands[0].click(); return (cands[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
  return null;
});
console.log('判型ボタン:', trimBtnFound);
if (trimBtnFound) {
  await page.waitForTimeout(3000);
  const trims = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] *, .a-popover *')]
    .filter((x) => /\d+(\.\d+)?\s*(mm|cm)?\s*[x×]\s*\d+/.test(x.textContent || '') && x.children.length === 0 && (x.offsetWidth || x.offsetHeight))
    .map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 25));
  console.log('判型候補:', JSON.stringify(trims));
  const a5 = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[role=dialog] *, .a-popover *')].find((x) => /148\s*(mm)?\s*[x×]\s*210|A5/.test(x.textContent || '') && x.children.length <= 1 && (x.offsetWidth || x.offsetHeight));
    if (c) { c.click(); return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); } return null;
  });
  console.log('A5選択:', a5);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] button, .a-popover button')].find((x) => /選択|適用|OK|保存|更新/.test(x.textContent || '')); if (b) b.click(); });
  await page.waitForTimeout(3000);
}

// アップロード: 「原稿をアップロード」/「表紙ファイルをアップロード」ボタン→filechooser(隠しinput直結ならfallback)
async function uploadVia(btnRe, file, fallbackIdx) {
  // overlay残骸を掃除してから
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  const btn = await page.evaluateHandle((re) => [...document.querySelectorAll('button,[role=button]')].find((x) => new RegExp(re).test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)), btnRe);
  const el = btn.asElement();
  if (!el) { console.log('アップロードボタン無し:', btnRe); return false; }
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
    el.click({ timeout: 15000 }).catch((e) => console.log('クリック妨害:', btnRe, e.message.slice(0, 60))),
  ]);
  if (!fc) {
    const ins = await page.$$('input[type=file]');
    if (ins.length > fallbackIdx) { await ins[fallbackIdx].setInputFiles(file); console.log('直接input投入:', btnRe); return true; }
    console.log('filechooserもinputも無し:', btnRe); return false;
  }
  await fc.setFiles(file);
  console.log('アップロード開始:', btnRe, '->', path.basename(file));
  return true;
}
await uploadVia('原稿をアップロード', interiorPdf, 0);
await page.waitForTimeout(4000);
await uploadVia('表紙ファイルをアップロード', coverPdf, 1);

// 変換待ち(最大12分)
for (let i = 0; i < 72; i++) {
  await page.waitForTimeout(10000);
  const t = await page.evaluate(() => document.body.textContent || '').catch(() => '');
  const ok = (t.match(/正常にアップロードしました|アップロードに成功|処理が完了しました/g) || []).length;
  const err = /アップロードで問題|アップロードに失敗|エラーが発生|問題が見つかりました/.test(t);
  if (i % 6 === 0) console.log(`  待機${i * 10}s ok=${ok} err=${err}`);
  if (err) { console.log('アップロードエラー'); await dump('step2-upload-error'); break; }
  if (ok >= 2) { console.log('両ファイルアップロード完了'); break; }
}
// AI コンテンツ質問: 「いいえ」(運営者方針 — Kindle版と同じ)
await page.check('input[name="has-ai-content"][value="no"]', { force: true }).catch(() => {});
console.log('AIコンテンツ=いいえ');
await dump('step2-after-upload');

// プレビューアー起動(あれば)
const prevBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /プレビューアーを起動|プレビューを起動/.test(x.textContent || '')); if (b) { b.click(); return true; } return false; });
console.log('プレビューアー起動:', prevBtn);
if (prevBtn) {
  // previewer は重い(1〜3分)。読み込み完了→「承認」を待つ
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(10000);
    const approve = await page.evaluate(() => { const b = [...document.querySelectorAll('button,a,input[type=submit]')].find((x) => /承認/.test((x.textContent || x.value || ''))); if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return true; } return false; });
    if (i % 3 === 0) console.log(`  previewer待機 ${i * 10}s approve=${approve}`);
    if (approve) { console.log('プレビュー承認クリック'); break; }
    if (await bodyHas(/問題が見つかりました|エラー/)) { console.log('previewerが問題を報告'); await dump('previewer-issue'); break; }
  }
  await page.waitForTimeout(8000);
  await dump('after-previewer');
}

// STEP2 続行 → STEP3(価格)
await page.click('#save-and-continue-announce').catch(() => console.log('step2 continue クリック失敗'));
await page.waitForTimeout(12000);
await checkLimit('step3-open');
await dump('step3-pricing');
// 価格・印刷費のテキストを抽出
const priceInfo = await page.evaluate(() => {
  const t = document.body.textContent || '';
  const m = [];
  for (const re of [/印刷費[用]?[^\n。]{0,60}/g, /最低価格[^\n。]{0,60}/g, /ロイヤリティ[^\n。]{0,40}/g]) { let x; while ((x = re.exec(t)) && m.length < 20) m.push(x[0].replace(/\s+/g, ' ').trim()); }
  return m;
});
console.log('価格情報:', JSON.stringify(priceInfo, null, 1));

console.log('\n===== PILOT DONE: 出版はクリックしていません(下書きのまま) =====');
console.log('URL:', page.url());
await shot('final');
await ctx.close();
process.exit(0);
