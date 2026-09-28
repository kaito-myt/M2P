/**
 * note エディタ上で「Markdown の表がどんな DOM になっているか」を採取する (F-ANP-48)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-table-recon.mjs <note_article_id>
 *
 * **保存/更新は一切しない**（開いて読むだけ）ので、公開中の記事は変わらない。
 */
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

const ARTICLE_ID = process.argv[2];
if (!ARTICLE_ID) {
  console.error('usage: node scripts/anp/note-table-recon.mjs <note_article_id>');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(
    `select a.id, a.title, a.note_url, acc.session_state_enc
       from note_articles a join note_accounts acc on acc.id = a.note_account_id
      where a.id = $1`,
    [ARTICLE_ID],
  );
  await c.end();
  if (rows.length === 0) {
    console.error('記事が見つかりません');
    process.exit(1);
  }
  const a = rows[0];
  const noteId = (a.note_url.match(/\/n\/(n[0-9a-z]+)/i) ?? [])[1];
  console.log('article:', a.title, '\nnoteId:', noteId);

  const state = JSON.parse(dec(a.session_state_enc, process.env.KDP_CRED_KEY));
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      storageState: state,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1300 },
    });
    const page = await ctx.newPage();
    await page.goto(`https://editor.note.com/notes/${noteId}/edit/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    console.log('url:', page.url());

    const dump = await page.evaluate(() => {
      const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
      if (!root) return { error: 'no ProseMirror' };
      const kids = [...root.children];
      return {
        count: kids.length,
        items: kids.slice(0, 60).map((el, i) => ({
          i,
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 40),
          text: (el.textContent || '').trim().slice(0, 70),
        })),
      };
    });
    console.log(JSON.stringify(dump, null, 1));
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
