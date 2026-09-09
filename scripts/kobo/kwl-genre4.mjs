import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64) { const raw = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].kobo_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

// 「ジャンル 1」スロットの実チップ内容を読む(ラベル "ジャンル 1" を除いた実値)
const slot1 = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((e) => e.offsetParent !== null && /^ジャンル\s*1$/.test((e.textContent || '').trim()));
  // スロット枠(ジャンル1 ラベルを含むカード)の全テキスト
  for (const lab of els) {
    let card = lab; for (let i = 0; i < 4 && card; i++) { card = card.parentElement; if (card && (card.textContent || '').length > (lab.textContent || '').length + 2) break; }
    const txt = (card?.textContent || '').replace(/\s+/g, ' ').replace(/ジャンル\s*[123]/g, '').trim();
    return txt.slice(0, 40);
  }
  return '(no-slot)';
});
const red = () => page.evaluate(() => [...document.querySelectorAll('*')].some((e) => e.offsetParent !== null && e.children.length === 0 && /1つ以上ご選択ください/.test((e.textContent || '').trim())));

console.log('初期 ジャンル1:', JSON.stringify(await slot1()), '赤字:', await red());
// トップ「ビジネス・経済・就職 ›」クリック
await page.getByText(/^ビジネス・経済・就職\s*›?\s*$/).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(2500);
console.log('トップ後 ジャンル1:', JSON.stringify(await slot1()), '赤字:', await red());
// 展開後の全可視項目(トップ以外の新規=サブ)
const items = await page.evaluate(() => [...document.querySelectorAll('li,a,button,[role=button]')].filter((e) => e.offsetParent !== null && e.children.length <= 1).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1 && t.length < 22 && !/ダッシュボード|マイアカウント|ヘルプ|ログアウト|作品一覧|楽天|スキップ|保存|出版|追加|通貨/.test(t)));
console.log('展開後の可視項目:', JSON.stringify([...new Set(items)].slice(0, 25)));
// 最初のサブ的な項目(› 付き or 一般)をクリック
for (const cand of [...new Set(items)]) {
  if (/^ビジネス・経済・就職$/.test(cand)) continue;
  const el = page.getByText(cand, { exact: true }).first();
  if (await el.count().catch(() => 0)) {
    await el.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    const s = await slot1(); const rd = await red();
    console.log('クリック[' + cand + ']→ ジャンル1:', JSON.stringify(s), '赤字:', rd);
    if (!rd && s && s !== '(no-slot)' && s.length > 1) { console.log('★スロット充填成功: ' + cand); break; }
  }
}
await browser.close();
process.exit(0);
