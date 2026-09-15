/**
 * note サーバー側自動公開 (Playwright) [docs/11-anp-design.md §2.1/§7, F-ANP-20]。
 *
 * `scripts/anp/note-editor-recon*.mjs` (2026-09-15) で採取した実 DOM に基づく実装。
 *   1. https://note.com/notes/new → https://editor.note.com/notes/<noteId>/edit/ へリダイレクト
 *      (この時点で noteId 確定 — 呼出側が即 NoteArticle.note_url に保存できるよう先頭で返す)。
 *   2. タイトル `textarea[placeholder="記事タイトル"]` / 本文 `div.ProseMirror[contenteditable=true]`。
 *      **既存下書きの resume は行わず、毎回 `note.com/notes/new` で新規下書きを作る**
 *      （2026-09-16 code review で resume 時の重複挿入バグを発見・実機検証。body focus 後
 *      `Control+A`→`Delete` で全消去を試みたが、note の ProseMirror はカーソル位置が
 *      末尾に来るとは限らず、選択範囲がドキュメント全体にならないため新規テキストが
 *      既存リストの途中に挿入され、既存本文の重複が解消しなかった。note は KDP のような
 *      作成数上限が無いため、失敗時に下書きが積み残る方を安全側として選択した。
 *      `NoteArticleInput.existingNoteUrl` は追跡表示用に保持するのみで、公開処理では
 *      参照しない）。
 *   3. 見出し/箇条書き/画像/有料エリア指定は本文ツールバーの「+」挿入メニュー配下のボタン
 *      (textContent で特定、aria-label 無し)。**必ず先に `button[aria-label="メニューを開く"]`
 *      をクリックしてメニューを展開してから項目をクリックする**（未展開でも一部条件下では
 *      動作したが、確実性のため明示的に開く。開けなかった/項目が見つからない場合は log.warn し
 *      有料エリア指定は §のブロック処理へ、それ以外はプレーンテキストとして続行する）。
 *   4. 「下書き保存」を必ず押す(dry_run はここで終了)。
 *   5. **有料記事の実公開(dry_run=false)は価格/有料ライン設定 UI が未実装のため、
 *      「公開に進む」を押す前に必ず `blocked` で中断する**（`shouldBlockPaidPublish`）。
 *      有料エリア指定マーカーの挿入に失敗した場合も同様に中断する(有料本文が無料公開される
 *      経路を塞ぐ)。
 *   6. 記事タイプ(`#free`/`#paid` name=is_paid)のラジオは視覚的に隠された `<input>` で
 *      **synthetic click (`el.click()`) では note の React ハンドラが切り替わらない**
 *      （BW の非表示チェックボックスと同型の罠、2026-09-15 実証）。祖先 `<label>` の
 *      `getBoundingClientRect()` を evaluate で取得し、Node 側から `page.mouse.click(x, y)`
 *      する trusted click で切り替える。実際に切り替わると note が「本人情報の登録」
 *      モーダル(氏名/住所等の KYC)を要求することを確認済み — 上記 5 によりこの経路は
 *      現状の実公開フローには到達しない(価格 UI 実装時に有効化する下準備として残す)。
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。evaluate 内は DOM 参照可。
 */
import path from 'node:path';

import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';

const log = createLogger('worker.note-publish.playwright');

const NEW_NOTE_URL = 'https://note.com/notes/new';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface NotePublishBlock {
  kind: 'h1' | 'h2' | 'bullet' | 'paragraph';
  text: string;
}

export interface NoteArticleInput {
  id: string;
  title: string;
  /** 段落分解済みブロック列 (有料ラインの前後で 2 系列に分ける)。 */
  freeBlocks: NotePublishBlock[];
  paidBlocks: NotePublishBlock[];
  paid: boolean;
  priceJpy: number | null;
  /**
   * 既に採番済みの note 記事 URL/下書き URL (前回試行の記録)。resume には使わず
   * (本文重複バグのため廃止済み、ファイル冒頭コメント参照)、ログ/デバッグ表示用に保持するのみ。
   */
  existingNoteUrl?: string | null;
  /** ローカル tmp のアイキャッチ画像パス (無ければ画像挿入をスキップ)。 */
  eyecatchPath?: string | null;
}

export interface NotePublishArgs {
  article: NoteArticleInput;
  /** 復号済み storageState (JSON文字列)。 */
  sessionState: string;
  /** true = 「公開に進む」以降を押さず下書き保存で止める。 */
  dryRun: boolean;
  /** スクショ保存先ディレクトリ。 */
  stageDir: string;
}

export type NotePublishResult =
  | { ok: true; status: 'draft' | 'published'; noteUrl: string; storageState?: string }
  | {
      ok: false;
      reason: 'not_logged_in' | 'kyc_required' | 'blocked' | 'error';
      message: string;
      noteUrl?: string;
      storageState?: string;
    };

export interface NoteCheckPublishedArgs {
  noteUrl: string;
  sessionState: string;
}

export type NoteCheckPublishedResult =
  | { ok: true; status: 'live' | 'unlisted' }
  | { ok: false; reason: 'not_logged_in' | 'error'; message: string };

export interface NotePublishPort {
  publishOne(args: NotePublishArgs): Promise<NotePublishResult>;
  checkPublished(args: NoteCheckPublishedArgs): Promise<NoteCheckPublishedResult>;
}

export function createPlaywrightNotePublishPort(): NotePublishPort {
  return { publishOne, checkPublished };
}

/**
 * 有料記事の実公開(dry_run=false)を「公開に進む」より前に止めるべきか。
 * 価格/有料ライン設定 UI が未実装のため、有料記事は下書き保存までしか自動化しない
 * (code review 2026-09-16 指摘 #2)。純関数として切り出しユニットテスト可能にする。
 */
export function shouldBlockPaidPublish(paid: boolean, dryRun: boolean): boolean {
  return paid && !dryRun;
}

// ---------------------------------------------------------------------------
// 実装
// ---------------------------------------------------------------------------

async function publishOne(args: NotePublishArgs): Promise<NotePublishResult> {
  const { article: a, dryRun, stageDir } = args;

  let storageStateObj: unknown;
  try {
    storageStateObj = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'error', message: 'session state is not valid JSON' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'error', message: `playwright unavailable: ${errMsg(err)}` };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      storageState: storageStateObj as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1300 },
    });
    // tsx(esbuild keepNames) の __name 未定義対策(KDP/BW/note-engage と同じ no-op シム)。
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(45000);

    // 1. 常に新規下書きを作成して noteId を採番する(resume は本文重複バグのため廃止済み。
    //    ファイル冒頭コメント参照。前回の下書きは note 上に残るため運営者が適宜整理する)。
    await page.goto(NEW_NOTE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(5000);

    if (/\/login\b|\/signin\b/i.test(page.url()) || (await page.$('input[type=password]').catch(() => null))) {
      await screenshot(page, stageDir, `${a.id}-not-logged-in`);
      return { ok: false, reason: 'not_logged_in', message: `セッション失効 (url=${page.url().slice(0, 90)})` };
    }

    const noteIdMatch = page.url().match(/editor\.note\.com\/notes\/([a-z0-9]+)\//i);
    if (!noteIdMatch) {
      await screenshot(page, stageDir, `${a.id}-noteid-not-found`);
      return { ok: false, reason: 'error', message: `note エディタへのリダイレクトを検出できません (url=${page.url()})` };
    }
    const noteId = noteIdMatch[1];
    const draftEditUrl = `https://editor.note.com/notes/${noteId}/edit/`;
    log.info({ articleId: a.id, noteId, previousNoteUrl: a.existingNoteUrl ?? null }, 'note draft acquired (new draft)');

    const titleReady = await page
      .waitForSelector('textarea[placeholder="記事タイトル"]', { state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!titleReady) {
      await screenshot(page, stageDir, `${a.id}-no-title-field`);
      return { ok: false, reason: 'error', message: 'タイトル欄が表示されません', noteUrl: draftEditUrl };
    }

    // 2. タイトル入力。
    const titleEl = await page.$('textarea[placeholder="記事タイトル"]');
    await titleEl?.click();
    await page.keyboard.type(a.title, { delay: 5 });

    // 3. 見出し画像(あれば)。「+」挿入メニュー→「画像」ボタン→filechooser。
    if (a.eyecatchPath) {
      const inserted = await insertEyecatch(page, a.eyecatchPath).catch((err) => {
        log.warn({ err: errMsg(err), articleId: a.id }, 'eyecatch insert failed — continuing without it');
        return false;
      });
      if (!inserted) log.warn({ articleId: a.id }, 'eyecatch button not found — skipping');
    }

    // 4. 本文流し込み(常に新規下書きの空欄へ)。
    const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
    await body.click({ timeout: 15000 }).catch(() => {});
    for (const block of a.freeBlocks) {
      await typeBlock(page, block, a.id);
    }
    if (a.paid && a.paidBlocks.length > 0) {
      const markerInserted = await insertPaywallMarker(page).catch((err) => {
        log.warn({ err: errMsg(err), articleId: a.id }, '有料エリア指定の挿入で例外');
        return false;
      });
      if (!markerInserted) {
        // 有料ラインを引けないまま有料本文を続けて流し込むと、無料記事として保存された
        // 場合に有料本文が無料公開されてしまうため、ここで必ず中断する(code review #2)。
        await screenshot(page, stageDir, `${a.id}-paywall-marker-failed`);
        return {
          ok: false,
          reason: 'blocked',
          message: '有料ライン(有料エリア指定)の挿入に失敗したため中断しました(有料本文の誤公開防止)',
          noteUrl: draftEditUrl,
        };
      }
      for (const block of a.paidBlocks) {
        await typeBlock(page, block, a.id);
      }
    }
    await page.waitForTimeout(1500);
    await screenshot(page, stageDir, `${a.id}-body-filled`);

    // 5. 下書き保存(必須・dry_run はここで終了)。
    const draftSaved = await clickByText(page, '下書き保存');
    await page.waitForTimeout(3000);
    await screenshot(page, stageDir, `${a.id}-draft-saved`);
    if (!draftSaved) {
      return { ok: false, reason: 'error', message: '「下書き保存」ボタンが見つかりません', noteUrl: draftEditUrl };
    }
    if (dryRun) {
      return { ok: true, status: 'draft', noteUrl: draftEditUrl };
    }

    // 有料記事の価格/有料ライン設定 UI は未実装 — 実公開は必ずここで止める(code review #2)。
    if (shouldBlockPaidPublish(a.paid, dryRun)) {
      await screenshot(page, stageDir, `${a.id}-paid-publish-unsupported`);
      return {
        ok: false,
        reason: 'blocked',
        message: '有料記事の価格/有料ライン設定は未実装のため実公開できません(下書きは保存済み)',
        noteUrl: draftEditUrl,
      };
    }

    // 6. 公開設定へ(この時点で a.paid===false であることが保証されている)。
    const proceeded = await clickByText(page, '公開に進む');
    if (!proceeded) {
      await screenshot(page, stageDir, `${a.id}-no-proceed-button`);
      return { ok: false, reason: 'blocked', message: '「公開に進む」ボタンが見つかりません(タイトル/本文未入力の可能性)', noteUrl: draftEditUrl };
    }
    await page.waitForTimeout(5000);
    await screenshot(page, stageDir, `${a.id}-publish-settings`);

    const posted = await clickByText(page, '投稿する');
    if (!posted) {
      await screenshot(page, stageDir, `${a.id}-no-post-button`);
      return { ok: false, reason: 'blocked', message: '「投稿する」ボタンが見つかりません', noteUrl: draftEditUrl };
    }
    await page.waitForTimeout(6000);
    await screenshot(page, stageDir, `${a.id}-after-post`);

    const publicUrl = await resolvePublicUrl(page, noteId);
    if (!publicUrl) {
      return {
        ok: false,
        reason: 'blocked',
        message: '投稿後の公開URLを確認できませんでした(本文ページ遷移なし)',
        noteUrl: draftEditUrl,
      };
    }
    return { ok: true, status: 'published', noteUrl: publicUrl };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function checkPublished(args: NoteCheckPublishedArgs): Promise<NoteCheckPublishedResult> {
  let storageStateObj: unknown;
  try {
    storageStateObj = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'error', message: 'session state is not valid JSON' };
  }
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'error', message: `playwright unavailable: ${errMsg(err)}` };
  }
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      storageState: storageStateObj as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(30000);
    const resp = await page.goto(args.noteUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForTimeout(2000);
    if (/\/login\b/i.test(page.url())) {
      return { ok: false, reason: 'not_logged_in', message: 'セッション失効' };
    }
    const status = resp?.status?.() ?? 0;
    if (status === 404) return { ok: true, status: 'unlisted' };
    const bodyText: string = await page.locator('body').innerText().catch(() => '');
    if (/このページは存在しません|ページが見つかりません|非公開/.test(bodyText)) {
      return { ok: true, status: 'unlisted' };
    }
    return { ok: true, status: 'live' };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 本文ツールバー/挿入メニューのボタンを textContent で特定してクリックする(aria-label 無しの物が多い)。 */
async function clickByText(page: Page, text: string): Promise<boolean> {
  return page
    .evaluate((t: string) => {
      const el = [...document.querySelectorAll('button,[role=button]')].find(
        (x) => (x.textContent || '').trim() === t && ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
      ) as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    }, text)
    .catch(() => false);
}

/**
 * 現在行の左に出る「+」挿入メニューを開く(`button[aria-label="メニューを開く"]`、
 * 2026-09-16 `scripts/anp/note-editor-recon6.mjs` で採取)。見出し/箇条書き/画像/
 * 有料エリア指定はこのメニュー配下のボタンのため、確実性のため必ず先に開く。
 */
async function openPlusMenu(page: Page): Promise<boolean> {
  const opened = await page
    .evaluate(() => {
      const btn = document.querySelector('button[aria-label="メニューを開く"]') as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    })
    .catch(() => false);
  if (opened) await page.waitForTimeout(300);
  return opened;
}

async function typeBlock(page: Page, block: NotePublishBlock, articleId: string): Promise<void> {
  if (block.kind === 'h1' || block.kind === 'h2') {
    await openPlusMenu(page);
    const label = block.kind === 'h1' ? '大見出し' : '小見出し';
    const clicked = await clickByText(page, label);
    if (!clicked) log.warn({ articleId, block: label }, '見出しボタンが見つかりません — プレーンテキストとして続行');
    await page.waitForTimeout(200);
    await page.keyboard.type(block.text, { delay: 5 });
    await page.keyboard.press('Enter');
  } else if (block.kind === 'bullet') {
    await openPlusMenu(page);
    const clicked = await clickByText(page, '箇条書きリスト');
    if (!clicked) log.warn({ articleId, block: 'bullet' }, '箇条書きリストボタンが見つかりません — プレーンテキストとして続行');
    await page.waitForTimeout(200);
    const lines = block.text.split('\n').filter((l) => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      await page.keyboard.type(lines[i]!.replace(/^[-・]\s*/, ''), { delay: 5 });
      await page.keyboard.press('Enter');
    }
    // 空行で Enter するとリストを抜ける(ProseMirror の一般的挙動)。
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.type(block.text, { delay: 5 });
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(150);
}

/**
 * 本文ツールバーの「+」挿入メニューから「有料エリア指定」をクリックしてカーソル位置に区切りを
 * 挿む。成功可否を返す(失敗時は呼出側が有料本文の入力を中断する)。
 */
async function insertPaywallMarker(page: Page): Promise<boolean> {
  await openPlusMenu(page);
  const clicked = await clickByText(page, '有料エリア指定');
  if (!clicked) {
    log.warn({}, '有料エリア指定ボタンが見つかりません');
    return false;
  }
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  return true;
}

/** 見出し画像を「+」挿入メニュー→「画像」ボタン→filechooser で投入。 */
async function insertEyecatch(page: Page, eyecatchPath: string): Promise<boolean> {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await openPlusMenu(page);
  const clicked = await clickByText(page, '画像');
  if (!clicked) {
    log.warn({}, '画像ボタンが見つかりません');
    return false;
  }
  const chooser = await chooserPromise;
  if (!chooser) return false;
  await chooser.setFiles(eyecatchPath);
  await page.waitForTimeout(3000);
  return true;
}

/**
 * 記事タイプを「有料」に切り替え、note の本人情報登録(KYC)モーダルが出るか確認する。
 * 出た場合は true(=公開不可)を返す。モーダルはキャンセル/未入力のまま次に進む。
 *
 * ⚠️ `#paid` は視覚的に隠された radio input で、evaluate 内の synthetic `.click()` では
 * note の React ハンドラが発火せず切り替わらない(2026-09-16 code review で発見、BW の非表示
 * checkbox と同型の罠)。祖先 `<label>` の bounding rect を evaluate で取得し、Node 側から
 * `page.mouse.click(x, y)` する trusted click で切り替える(`scripts/anp/note-editor-recon5.mjs`
 * で実証)。現状は `shouldBlockPaidPublish` により有料記事の実公開経路がこの手前で止まるため
 * 呼び出し箇所が無いが、価格/有料ライン UI 実装時に再度呼び出すためロジックを維持する。
 */
async function selectPaidAndCheckKyc(page: Page): Promise<boolean> {
  const box = await page
    .evaluate(() => {
      const input = document.querySelector('#paid') as HTMLInputElement | null;
      if (!input) return null;
      let node: HTMLElement | null = input;
      for (let i = 0; i < 6 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        if (node.tagName === 'LABEL' || getComputedStyle(node).cursor === 'pointer') break;
      }
      const target = node ?? input;
      const r = target.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(20, r.height / 2) };
    })
    .catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2000);
  const bodyText: string = await page.locator('body').innerText().catch(() => '');
  return /本人情報の登録|本人情報の入力/.test(bodyText);
}

// selectPaidAndCheckKyc は現状未呼び出し(shouldBlockPaidPublish で手前で止まるため)。
// 価格/有料ライン UI 実装時に有効化するので、未使用警告を避けるためここで参照だけ残す。
void selectPaidAndCheckKyc;

/** 投稿後、note.com/<handle>/n/<noteId> 形式へ遷移しているか確認する。 */
async function resolvePublicUrl(page: Page, noteId: string): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    const url = page.url();
    const m = url.match(/note\.com\/[^/]+\/n\/([a-z0-9]+)/i);
    if (m && m[1] === noteId) return url;
    await page.waitForTimeout(2000);
  }
  return null;
}

async function screenshot(page: Page, stage: string, name: string): Promise<void> {
  let buf: Buffer | null = null;
  try {
    buf = await page.screenshot({ fullPage: true });
    await import('node:fs').then((fs) => fs.writeFileSync(path.join(stage, name + '.png'), buf!)).catch(() => {});
  } catch {
    /* best-effort local */
  }
  if (buf) {
    try {
      const mod = await import('@a2p/storage');
      const key = `debug/note-publish/${name}-${Date.now()}.png`;
      await mod.uploadBuffer(key, buf, 'image/png');
      log.info({ key }, 'saved note-publish debug shot');
    } catch {
      /* best-effort R2 */
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
