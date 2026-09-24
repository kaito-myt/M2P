// note の本人情報 (KYC) 登録状況を確認する READ-ONLY 偵察 (F-ANP-16b)。
// 「有料記事の自動公開」トグルを ON にして良いか (= 有料選択時に本人情報モーダルが出ないか) を
// 記事を触らずに判定するために、売上管理/アカウント設定の該当セクションを読むだけ。
//   bash scripts/anp/note-kyc-recon.sh [<note_account_id> ...]
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const wanted = process.argv.slice(2);
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('select id, display_name, handle, session_state_enc from note_accounts order by created_at');
await c.end();
const targets = r.rows.filter((row) => (wanted.length ? wanted.includes(row.id) : true));

const URLS = (process.env.KYC_URLS || 'https://note.com/settings/account,https://note.com/sitesettings/stats').split(',');

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
for (const acc of targets) {
  console.log(`\n===== ${acc.id} ${acc.display_name} (@${acc.handle ?? '-'})`);
  if (!acc.session_state_enc) {
    console.log('  session なし — スキップ');
    continue;
  }
  let state;
  try {
    state = JSON.parse(dec(acc.session_state_enc, process.env.KDP_CRED_KEY));
  } catch (e) {
    console.log('  session 復号失敗:', e.message);
    continue;
  }
  const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 1200 } });
  await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
  const page = await ctx.newPage();
  for (const url of URLS) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('  goto err', e.message));
    await page.waitForTimeout(6000);
    console.log(`  ${url} -> ${page.url()}`);
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    console.log('   title:', await page.title(), 'textLen:', text.length, 'hasPassword:', !!(await page.$('input[type=password]').catch(() => null)));
    console.log('   head:', JSON.stringify(text.split(/\s*\n\s*/).join(' | ').slice(0, 900)));
    const links = await page
      .evaluate(() => [...document.querySelectorAll('a')].map((a) => ({ h: a.getAttribute('href') || '', t: (a.textContent || '').trim().slice(0, 24) })).filter((x) => x.h.startsWith('/settings') || x.h.startsWith('/sitesettings') || /本人|売上|振込|設定/.test(x.t)))
      .catch(() => []);
    const seen = new Set();
    const uniq = links.filter((l) => (seen.has(l.h + l.t) ? false : (seen.add(l.h + l.t), true)));
    console.log('   nav links:', JSON.stringify(uniq.slice(0, 40)));
    const hits = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && /本人|確認|登録情報|口座|振込|審査|マイナンバー/.test(l));
    console.log('   hits:', JSON.stringify(hits.slice(0, 25), null, 0));
  }
  await ctx.close();
}
await browser.close();
