/**
 * 印刷プレビューアーの実DOM診断。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-diag-preview.mjs <titleId>
 *
 * 目的:
 *  (1) 総頁数表示のセレクタを実採取する (`#cur_page_range` が現行UIで有効か)
 *  (2) 「承認」ボタンの有無・セレクタを実採取する
 *  (3) レビューパネルが報告する問題文を全件抜き出す (表紙セーフゾーン違反等)
 * 何も変更しない (クリックはプレビューアー起動のみ・承認は押さない)。
 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');

const titleId = process.argv[2];
if (!titleId) { console.log('usage: pb-diag-preview.mjs <titleId>'); process.exit(1); }

const AMZ_PW = process.env.AMAZON_PASSWORD;
const TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1760, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'],
});
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function passReauth() {
  if (!/\/ap\/signin/.test(page.url())) return;
  console.log('再認証中...');
  const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
  if (!pf || !AMZ_PW) return;
  await pf.click({ force: true }).catch(() => {});
  await pf.type(AMZ_PW, { delay: 35 });
  await page.click('#signInSubmit').catch(() => {});
  await page.waitForTimeout(9000);
  const otp = await page.$('#auth-mfa-otpcode');
  if (otp && TOTP) {
    const { authenticator } = req('otplib');
    await otp.type(authenticator.generate(TOTP), { delay: 35 });
    await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(9000);
  }
}

await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await passReauth();
console.log('content URL:', page.url());

const launched = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a')].find((x) => /プレビューアーを起動|プレビューを起動/.test(x.textContent || ''));
  if (b) { b.click(); return true; }
  return false;
});
console.log('プレビューアー起動:', launched);

// プレビューアーの読み込みを待つ (承認ボタン出現 or 90秒)
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(5000);
  const ready = await page.evaluate(() =>
    [...document.querySelectorAll('button,a,input[type=submit]')]
      .some((x) => /承認/.test(x.textContent || x.value || '') && (x.offsetWidth || x.offsetHeight))
  ).catch(() => false);
  if (ready) { console.log(`承認ボタン検出 (${i * 5}s)`); break; }
  if (i % 3 === 0) console.log(`  待機 ${i * 5}s`);
}

const diag = await page.evaluate(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
  const out = {};

  // (1) 総頁数まわり: id に page/range を含む input を全部拾う
  out.pageInputs = [...document.querySelectorAll('input')]
    .filter((i) => /page|range/i.test(i.id + ' ' + i.name))
    .map((i) => ({
      id: i.id, name: i.name, value: i.value, visible: vis(i),
      parentText: (i.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      grandParentText: (i.parentElement?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }));

  // (2) 「/ NNN」形式のテキストを持つ要素 (最も内側)
  out.slashTotals = [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && /\/\s*\d{2,4}/.test(e.textContent || ''))
    .slice(0, 8)
    .map((e) => ({ tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 60), text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }));

  // (3) 「承認」を含む要素を全タグから網羅採取 (span.a-button 構造・disabled・実座標まで)
  out.approve = [...document.querySelectorAll('*')]
    .filter((e) => {
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      return /承認/.test(own) || (/^\s*承認\s*$/.test((e.textContent || '').trim()) && e.children.length <= 2);
    })
    .slice(0, 12)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 90),
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        visible: vis(e), disabled: !!e.disabled, ariaDisabled: e.getAttribute('aria-disabled'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        parentCls: (e.parentElement?.className || '').toString().slice(0, 90),
        // 実際にその座標で最前面に来る要素 (クリックが誰に当たるか)
        topAt: (() => {
          const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return t ? `${t.tagName}.${(t.className || '').toString().slice(0, 50)}` : null;
        })(),
      };
    });
  out.buttons = [...document.querySelectorAll('button,a,input[type=submit],[role=button]')]
    .filter((b) => /終了|プレビュー/.test(b.textContent || b.value || ''))
    .map((b) => ({ tag: b.tagName, id: b.id, cls: (b.className || '').toString().slice(0, 70), text: (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().slice(0, 40), visible: vis(b), disabled: !!b.disabled }));

  // (4) レビューパネルの問題文 (表紙セーフゾーン違反等)
  const reviewRoot = [...document.querySelectorAll('div,section,aside')]
    .find((d) => /レビュー/.test(d.textContent || '') && d.querySelectorAll('*').length < 400);
  out.reviewText = reviewRoot ? (reviewRoot.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 3000) : null;

  // (5) 本文中の警告ワード
  const body = document.body.innerText || '';
  out.hits = ['9.5', 'セーフ', '切れて', '端に近', 'フォント', '問題が見つかり', '解像度', '裁ち落とし']
    .filter((w) => body.includes(w));
  out.iframes = [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 100));

  // (6) 承認ボタンの enabled/disabled 状態 (KDP は別要素を出し分ける)
  const en = document.querySelector('#printpreview_approve_button_enabled');
  const dis = document.querySelector('#printpreview_approve_button_disabled');
  out.approveState = {
    enabledExists: !!en, enabledVisible: en ? vis(en) : null,
    disabledExists: !!dis, disabledVisible: dis ? vis(dis) : null,
  };

  // (7) 問題JSON全文 (type/page/locations)。レビューパネルの人間可読な問題文も全文で。
  out.issuesRaw = (() => {
    const s = [...document.querySelectorAll('script')].map((x) => x.textContent || '').find((t) => t.includes('"issues"'));
    return s || null;
  })();
  out.reviewFull = (() => {
    const root = [...document.querySelectorAll('div,section,aside')]
      .find((d) => /レビュー/.test(d.textContent || '') && d.querySelectorAll('*').length < 400);
    if (!root) return null;
    // 赤枠の問題ボックスだけを個別に取る
    return [...root.querySelectorAll('div,p,li')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 25 && t.length < 400)
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 20);
  })();
  return out;
});

console.log('\n===== DIAG =====');
console.log(JSON.stringify(diag, null, 2));
await page.screenshot({ path: path.join(OUT, 'diag-previewer.png'), fullPage: true }).catch(() => {});
console.log('\nscreenshot: scripts/paperback/out/diag-previewer.png');

// --page=N : 指定ページへ移動して撮影 (GUTTER_ISSUE の実物を目視するため)
const pageArg = (process.argv.find((a) => a.startsWith('--page=')) || '').split('=')[1];
if (pageArg) {
  const inp = await page.$('#cur_page_range');
  if (inp) {
    await inp.click({ clickCount: 3 }).catch(() => {});
    await inp.fill(String(pageArg)).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(9000);
    const f = path.join(OUT, `diag-page${pageArg}.png`);
    await page.screenshot({ path: f, fullPage: true }).catch(() => {});
    console.log(`page ${pageArg} screenshot: scripts/paperback/out/diag-page${pageArg}.png`);
  } else {
    console.log('#cur_page_range が無い — ページ移動不可');
  }
}
await ctx.close();
