/** 実行中の下書きcontentページに別接続して現在のアップロード/検証状態をダンプ(READ-ONLY) */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata2');
const titleId = process.argv[2] || 'TN2S3HGG343';
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('URL:', page.url());
const st = await page.evaluate(() => {
  const t = document.body.textContent || '';
  const grab = (re) => (t.match(re) || []).slice(0, 4);
  return {
    uploaded: grab(/正常にアップロードしました|アップロードに成功|処理が完了/g),
    processing: grab(/処理しています|変換中|アップロード中|ファイルを準備/g),
    errors: grab(/エラー|問題が見つかりました|失敗|サポートされていません/g),
    trim: grab(/判型|\d+\s*(mm|cm)?\s*[x×]\s*\d+/g),
    isbn: (t.match(/97[89][-\d]{10,14}/) || [null])[0],
    buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetWidth || b.offsetHeight).map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean).slice(0, 20),
  };
});
console.log(JSON.stringify(st, null, 1));
await page.screenshot({ path: path.join(REPO, 'scripts/paperback/out/peek.png'), fullPage: true }).catch(() => {});
await ctx.close();
process.exit(0);
