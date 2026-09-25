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
 *   5. **有料記事の実公開 (F-ANP-16b, 2026-09-24)**: アカウント設定 `paid_publish_enabled` が ON の
 *      ときだけ有料で公開する (`shouldBlockPaidPublish(paid, dryRun, allowPaid)`)。OFF の間は従来どおり
 *      「公開に進む」前に `blocked` で中断する。有料エリア指定マーカーの挿入に失敗した場合も中断する
 *      (有料本文が無料公開される経路を塞ぐ)。有料公開の手順は
 *      記事タイプ `#paid` を trusted click → 本人確認 (KYC) モーダルが出たら中断 → 公開設定画面で
 *      価格入力欄に `priceJpy` を入力 → 「投稿する」。価格欄が見つからない場合も中断する(0円/誤価格防止)。
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
  /** F-ANP-16b: アカウント設定で有料公開が許可されているか (note の本人確認が済んでいるか)。 */
  allowPaid?: boolean;
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
  /**
   * F-ANP-42: 公開設定画面で付けるハッシュタグ (# 無し, 最大 5 個)。
   * note のタグ検索とハッシュタグページからの流入を取るための SEO 施策。
   */
  hashtags?: string[];
}

/**
 * [F-ANP-47] 公開済みの無料記事を**後から有料に切り替える**ための引数。
 *
 * 執筆時と違って本文に有料マーカーが残っていないので、note エディタ上で
 * 「有料エリア指定」を指定段落の先頭に挿入し直してから公開設定で有料に切り替える。
 */
export interface NoteMonetizeArgs {
  /** 対象記事 (ログ用)。 */
  articleId: string;
  /** 既存の note 記事 URL (https://note.com/<handle>/n/<noteId>)。 */
  noteUrl: string;
  /** 無料側に残すブロック数 (テキスト一致で見つからなかったときのフォールバック index)。 */
  freeBlockCount: number;
  /**
   * 有料側の先頭ブロックの文字列。note エディタのブロック構造は Markdown の段落と
   * 1:1 対応しないため、**まずこのテキストでブロックを特定**し、無ければ index を使う。
   */
  anchorText?: string;
  priceJpy: number;
  sessionState: string;
  /** true = 公開設定まで進めて「更新」は押さない。 */
  dryRun: boolean;
  stageDir: string;
}

export type NoteMonetizeResult =
  | { ok: true; status: 'monetized' | 'dry_run_ready'; noteUrl: string }
  | {
      ok: false;
      reason: 'not_logged_in' | 'kyc_required' | 'no_note_id' | 'no_paywall_slot' | 'blocked' | 'error';
      message: string;
      noteUrl?: string;
    };

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
  /** [F-ANP-47] 公開済みの無料記事を有料へ切り替える。 */
  monetizeOne(args: NoteMonetizeArgs): Promise<NoteMonetizeResult>;
}

export function createPlaywrightNotePublishPort(): NotePublishPort {
  return { publishOne, checkPublished, monetizeOne };
}

/** note 記事 URL から noteId (nXXXXXXXX) を取り出す。 */
export function extractNoteId(noteUrl: string): string | null {
  const m = noteUrl.match(/\/n\/(n[0-9a-z]+)/i) ?? noteUrl.match(/notes\/(n[0-9a-z]+)/i);
  return m ? m[1]! : null;
}

/**
 * 有料記事の実公開(dry_run=false)を「公開に進む」より前に止めるべきか。
 * 価格/有料ライン設定 UI が未実装のため、有料記事は下書き保存までしか自動化しない
 * (code review 2026-09-16 指摘 #2)。純関数として切り出しユニットテスト可能にする。
 */
export function shouldBlockPaidPublish(paid: boolean, dryRun: boolean, allowPaid = false): boolean {
  return paid && !dryRun && !allowPaid;
}

/**
 * note の公開 API (`user.urlname`) から公開 URL を組み立てる純関数 (ユニットテスト可能)。
 * `note_accounts.handle` の自動保存(`extractNoteHandle`, pipeline-note-publish.ts)は
 * この形式の URL を前提にしているため、フォーマットを一致させる。
 */
export function buildNotePublicUrl(urlname: string, noteId: string): string {
  return `https://note.com/${urlname}/n/${noteId}`;
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

    // 有料公開が許可されていないアカウントでは、実公開は必ずここで止める (KYC 未完了想定)。
    if (shouldBlockPaidPublish(a.paid, dryRun, a.allowPaid === true)) {
      await screenshot(page, stageDir, `${a.id}-paid-publish-unsupported`);
      return {
        ok: false,
        reason: 'blocked',
        message: '有料記事の自動公開が未許可です(アカウント設定「有料記事の自動公開」を ON に。下書きは保存済み)',
        noteUrl: draftEditUrl,
      };
    }

    // 5b. [F-ANP-16b] 有料記事: 記事タイプを有料に切り替える (KYC モーダルが出たら中断)。
    if (a.paid) {
      if (a.priceJpy === null || a.priceJpy <= 0) {
        await screenshot(page, stageDir, `${a.id}-paid-no-price`);
        return { ok: false, reason: 'blocked', message: '有料記事ですが価格が未設定のため中断しました(下書きは保存済み)', noteUrl: draftEditUrl };
      }
      const kyc = await selectPaidAndCheckKyc(page).catch((err) => {
        log.warn({ err: errMsg(err), articleId: a.id }, '有料切替で例外');
        return true;
      });
      if (kyc) {
        await screenshot(page, stageDir, `${a.id}-paid-kyc-required`);
        return {
          ok: false,
          reason: 'blocked',
          message:
            'note の本人情報登録(KYC)が未完了のため有料記事を公開できません(note の「設定 › お支払先 › お支払い口座」を登録後に再実行してください。下書きは保存済み)',
          noteUrl: draftEditUrl,
        };
      }
      await screenshot(page, stageDir, `${a.id}-paid-selected`);
    }

    // 6. 公開設定へ。
    const proceeded = await clickByText(page, '公開に進む');
    if (!proceeded) {
      await screenshot(page, stageDir, `${a.id}-no-proceed-button`);
      return { ok: false, reason: 'blocked', message: '「公開に進む」ボタンが見つかりません(タイトル/本文未入力の可能性)', noteUrl: draftEditUrl };
    }
    await page.waitForTimeout(5000);
    await screenshot(page, stageDir, `${a.id}-publish-settings`);

    // [F-ANP-16b] 有料記事は公開設定画面で価格を入力してから投稿する。
    if (a.paid && a.priceJpy !== null) {
      const priceSet = await fillPaidPrice(page, a.priceJpy).catch((err) => {
        log.warn({ err: errMsg(err), articleId: a.id }, '価格入力で例外');
        return false;
      });
      await screenshot(page, stageDir, `${a.id}-paid-price`);
      if (!priceSet) {
        return {
          ok: false,
          reason: 'blocked',
          message: '有料記事の価格入力欄が見つからないため中断しました(誤った価格での公開防止。下書きは保存済み)',
          noteUrl: draftEditUrl,
        };
      }
    }

    // [F-ANP-42] note 内 SEO: 公開設定画面でハッシュタグを付ける (入力欄は
    // `input[placeholder="ハッシュタグを追加する"]`。2026-09-24 実 DOM 確認)。
    const tags = (a.hashtags ?? []).filter((t) => t.trim().length > 0).slice(0, 5);
    if (tags.length > 0) {
      const added = await fillHashtags(page, tags).catch((err) => {
        log.warn({ err: errMsg(err), articleId: a.id }, 'ハッシュタグ入力で例外 — タグ無しで続行');
        return 0;
      });
      log.info({ articleId: a.id, requested: tags.length, added }, 'ハッシュタグ設定');
      await screenshot(page, stageDir, `${a.id}-hashtags`);
    }

    const posted = await clickByText(page, '投稿する');
    if (!posted) {
      await screenshot(page, stageDir, `${a.id}-no-post-button`);
      return { ok: false, reason: 'blocked', message: '「投稿する」ボタンが見つかりません', noteUrl: draftEditUrl };
    }
    await page.waitForTimeout(6000);
    await screenshot(page, stageDir, `${a.id}-after-post`);

    // 「投稿する」クリック後、note は本文ページへ遷移せず公開設定画面の上に「記事が公開されました」
    // モーダル(連続投稿日数 + X/Facebook/LINE/リンクコピーの共有ボタン)を出す挙動を確認済み
    // (2026-09-18 本番実公開で発覚)。URL 遷移 or このモーダルのテキスト検知のどちらかを
    // 投稿成功の確認とする(docs/11 §2.1/§7 参照)。
    const publishConfirmed = await waitForPublishConfirmation(page, noteId);
    if (!publishConfirmed) {
      return {
        ok: false,
        reason: 'blocked',
        message: '投稿後に公開完了を確認できませんでした(モーダル/URL遷移なし)',
        noteUrl: draftEditUrl,
      };
    }

    const publicUrl = await resolvePublishedUrl(page, noteId);
    if (!publicUrl) {
      return {
        ok: false,
        reason: 'blocked',
        message: '投稿は完了しましたが公開URLを確定できませんでした(note 公開API未反映)',
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

/**
 * [F-ANP-47] 公開済みの無料記事を有料に切り替える。
 *
 * 手順:
 *   1. `https://editor.note.com/notes/<noteId>/edit/` を開く (公開済み記事もここで編集できる)
 *   2. 本文 (`div.ProseMirror`) の `freeBlockCount` 番目の段落の先頭をクリックしてカーソルを置く
 *   3. 「+」メニュー → 「有料エリア指定」で有料ラインを挿入 (`insertPaywallMarker`)
 *   4. 「公開に進む」→ 記事タイプ `#paid` を trusted click → **本人情報(KYC)モーダルが出たら中断**
 *   5. 価格を入力 → 「更新する」(公開済み記事は「投稿する」ではなく更新ボタン)
 *
 * 途中で失敗しても記事は無料のまま公開され続ける (中断するだけで非公開化・削除はしない)。
 */
async function monetizeOne(args: NoteMonetizeArgs): Promise<NoteMonetizeResult> {
  const noteId = extractNoteId(args.noteUrl);
  if (!noteId) return { ok: false, reason: 'no_note_id', message: `note URL から noteId を取れません: ${args.noteUrl}` };

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
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(45000);

    await page
      .goto(`https://editor.note.com/notes/${noteId}/edit/`, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await page.waitForTimeout(6000);
    if (/\/login\b|\/signin\b/i.test(page.url()) || (await page.$('input[type=password]').catch(() => null))) {
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-not-logged-in`);
      return { ok: false, reason: 'not_logged_in', message: `セッション失効 (url=${page.url().slice(0, 90)})` };
    }

    const hasBody = await page
      .locator('div.ProseMirror[contenteditable="true"]')
      .first()
      .count()
      .catch(() => 0);
    if (!hasBody) {
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-no-body`);
      return { ok: false, reason: 'blocked', message: '本文エディタが見つかりません', noteUrl: args.noteUrl };
    }

    // 既に有料ラインがある記事には二重挿入しない (公開設定だけやり直す)。
    // 有料エリアは **`<paywall-line>` というカスタム要素**として本文に入る
    // (2026-09-25 `scripts/anp/note-paywall-recon.mjs` で実測)。本文の文字列
    // (「ここから先は」等) で判定すると記事本文の言い回しに誤反応するので使わない。
    const already = await page
      .evaluate(() => !!document.querySelector('div.ProseMirror[contenteditable="true"] paywall-line'))
      .catch(() => false);
    log.info({ articleId: args.articleId, noteId, already }, 'note monetize: editor opened');

    if (!already) {
      // 有料側の先頭にするブロックを特定する。
      // **Markdown の段落 index は当てにできない** (note エディタは複数段落を 1 つの `<p>` に
      // 束ねることがある。2026-09-25 実測) ため、まず `anchorText` のテキスト一致で探し、
      // 見つからないときだけ index にフォールバックする。
      const slot = await page
        .evaluate(
          ({ index, anchor }: { index: number; anchor: string }) => {
            const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
            if (!root) return null;
            const kids = [...root.children] as HTMLElement[];
            const norm = (t: string) => t.replace(/\s+/g, '');
            const target = norm(anchor ?? '');
            // 本文ブロック (空要素・画像 figure を除く) の一覧。
            const content = kids
              .map((el, i) => ({ el, i }))
              .filter(({ el }) => el.tagName !== 'FIGURE' && (el.textContent ?? '').trim().length > 0);
            if (content.length < 2) return null;

            if (target.length >= 4) {
              const hit = content.find(({ el }) => norm(el.textContent ?? '').startsWith(target));
              if (hit && hit !== content[0]) {
                return { childIndex: hit.i, matched: true, tag: hit.el.tagName, count: content.length };
              }
            }
            const at = Math.min(Math.max(index, 1), content.length - 1);
            const fallback = content[at]!;
            return { childIndex: fallback.i, matched: false, tag: fallback.el.tagName, count: content.length };
          },
          { index: args.freeBlockCount, anchor: args.anchorText ?? '' },
        )
        .catch(() => null);
      if (!slot) {
        await screenshot(page, args.stageDir, `${args.articleId}-monetize-no-slot`);
        return {
          ok: false,
          reason: 'no_paywall_slot',
          message: '有料ラインを置けるブロックが見つかりません(本文ブロックが 2 つ未満)',
          noteUrl: args.noteUrl,
        };
      }
      log.info({ articleId: args.articleId, ...slot, anchor: args.anchorText }, 'note monetize: paywall slot');

      // locator クリックで trusted click する (`page.mouse.click` だと自前スクロールが必要で、
      // 画面外の座標を叩いてカーソルが先頭のまま = 記事の冒頭に有料ラインが入る事故になる。
      // 2026-09-25 実測)。
      const block = page.locator('div.ProseMirror[contenteditable="true"] > *').nth(slot.childIndex);
      await block.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
      await block.click({ position: { x: 6, y: 6 }, timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.keyboard.press('Home').catch(() => {}); // ブロックの先頭へ寄せる
      await page.waitForTimeout(300);

      const inserted = await insertPaywallMarker(page, false);
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-paywall`);
      if (!inserted) {
        return {
          ok: false,
          reason: 'no_paywall_slot',
          message: '「有料エリア指定」を挿入できませんでした',
          noteUrl: args.noteUrl,
        };
      }
      await page.waitForTimeout(2000);

      // 実際に `<paywall-line>` が入ったか、どの位置に入ったかを確認する
      // (無料部分が 0 だと記事全体が有料になってしまうので、先頭付近なら中断)。
      const placed = await page
        .evaluate(() => {
          const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
          const line = root?.querySelector('paywall-line');
          if (!root || !line) return null;
          const kids = [...root.children];
          const at = kids.indexOf(line as Element);
          const freeText = kids
            .slice(0, at)
            .map((el) => el.textContent ?? '')
            .join('')
            .replace(/\s+/g, '');
          const allText = (root.textContent ?? '').replace(/\s+/g, '');
          return { at, freeChars: freeText.length, totalChars: allText.length };
        })
        .catch(() => null);
      log.info({ articleId: args.articleId, placed }, 'note monetize: paywall placed');
      if (!placed) {
        return {
          ok: false,
          reason: 'no_paywall_slot',
          message: '有料ラインの挿入を確認できませんでした',
          noteUrl: args.noteUrl,
        };
      }
      if (placed.totalChars > 0 && placed.freeChars / placed.totalChars < 0.05) {
        return {
          ok: false,
          reason: 'no_paywall_slot',
          message: `有料ラインが本文の先頭付近(無料 ${placed.freeChars}/${placed.totalChars} 字)に入ったため中断しました(記事全体が有料になるのを防ぐため)`,
          noteUrl: args.noteUrl,
        };
      }
    }

    if (!(await clickByText(page, '公開に進む'))) {
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-no-proceed`);
      return { ok: false, reason: 'blocked', message: '「公開に進む」が見つかりません', noteUrl: args.noteUrl };
    }
    await page.waitForTimeout(5000);

    const kyc = await selectPaidAndCheckKyc(page).catch(() => false);
    await screenshot(page, args.stageDir, `${args.articleId}-monetize-paid`);
    if (kyc) {
      return {
        ok: false,
        reason: 'kyc_required',
        message:
          'note の本人情報登録(KYC)が未完了のため有料に切り替えられません。note の「設定 › お支払先」を登録後に再実行してください(記事は無料のまま公開され続けます)',
        noteUrl: args.noteUrl,
      };
    }

    if (!(await fillPaidPrice(page, args.priceJpy).catch(() => false))) {
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-no-price`);
      return {
        ok: false,
        reason: 'blocked',
        message: '価格入力欄が見つかりません(0円/誤価格での公開を防ぐため中断)',
        noteUrl: args.noteUrl,
      };
    }

    if (args.dryRun) return { ok: true, status: 'dry_run_ready', noteUrl: args.noteUrl };

    // 公開済み記事の更新ボタンは「更新する」。表記ゆれに備え「投稿する」もフォールバックで見る。
    if (!(await clickByText(page, '更新する')) && !(await clickByText(page, '投稿する'))) {
      await screenshot(page, args.stageDir, `${args.articleId}-monetize-no-update`);
      return { ok: false, reason: 'blocked', message: '「更新する」ボタンが見つかりません', noteUrl: args.noteUrl };
    }
    await page.waitForTimeout(8000);
    await screenshot(page, args.stageDir, `${args.articleId}-monetize-after`);
    return { ok: true, status: 'monetized', noteUrl: args.noteUrl };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err), noteUrl: args.noteUrl };
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
async function insertPaywallMarker(page: Page, pressEnter = true): Promise<boolean> {
  await openPlusMenu(page);
  const clicked = await clickByText(page, '有料エリア指定');
  if (!clicked) {
    log.warn({}, '有料エリア指定ボタンが見つかりません');
    return false;
  }
  await page.waitForTimeout(300);
  // 執筆時は続けて本文を打つため改行する。既存本文への後付け(F-ANP-47)では
  // 余計な空段落を作らないよう改行しない。
  if (pressEnter) await page.keyboard.press('Enter');
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

/**
 * [F-ANP-42] 公開設定画面でハッシュタグを入力する。
 *
 * note の入力欄は placeholder「ハッシュタグを追加する」の text input で、
 * 1 件ごとに Enter で確定する。付けられた件数を返す (0 なら欄が見つからなかった)。
 * ハッシュタグは公開の必須条件ではないので、失敗しても投稿は続行する。
 */
async function fillHashtags(page: Page, tags: readonly string[]): Promise<number> {
  const input = await page
    .locator('input[placeholder="ハッシュタグを追加する"]')
    .first()
    .elementHandle({ timeout: 5000 })
    .catch(() => null);
  if (!input) return 0;
  let added = 0;
  for (const raw of tags) {
    const tag = raw.replace(/^#/, '').trim();
    if (tag.length === 0) continue;
    try {
      await input.click();
      await input.type(tag, { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      added += 1;
    } catch {
      break;
    }
  }
  return added;
}

/**
 * [F-ANP-16b] 公開設定画面で有料記事の価格を入力する。note の価格欄は `input[type=number]` か
 * 数値入力の text で、ラベル/プレースホルダに「価格」「円」を含む。見つからなければ false を返し、
 * 呼出側が中断する (0 円や誤った価格での公開を防ぐ)。
 */
async function fillPaidPrice(page: Page, priceJpy: number): Promise<boolean> {
  const value = String(Math.round(priceJpy));
  const selectors = [
    'input[name="price"]',
    'input#price',
    'input[type="number"]',
    'input[placeholder*="価格"]',
    'input[placeholder*="円"]',
    'input[aria-label*="価格"]',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const count = await loc.count().catch(() => 0);
    if (!count) continue;
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;
    await loc.click({ timeout: 5000 }).catch(() => {});
    await loc.fill('').catch(() => {});
    await loc.type(value, { delay: 60 }).catch(async () => {
      await loc.fill(value).catch(() => {});
    });
    await page.waitForTimeout(800);
    const actual: string = await loc.inputValue().catch(() => '');
    if (actual.replace(/[^0-9]/g, '') === value) return true;
  }
  return false;
}

/**
 * 「投稿する」後、投稿が実際に完了したかを確認する。note は本文ページへ遷移せず、
 * 公開設定画面の上に「記事が公開されました」モーダル(連続投稿日数 + 共有ボタン)を出すため、
 * URL 遷移 と モーダルのテキスト検知の**どちらか**が成立すれば成功とみなす
 * (2026-09-18 本番実公開で発覚、docs/11 §2.1/§7 参照)。
 */
async function waitForPublishConfirmation(page: Page, noteId: string): Promise<boolean> {
  const urlPattern = new RegExp(`note\\.com/[^/]+/n/${noteId}\\b`, 'i');
  for (let i = 0; i < 6; i++) {
    if (urlPattern.test(page.url())) return true;
    const bodyText: string = await page.locator('body').innerText().catch(() => '');
    if (/記事が公開されました/.test(bodyText)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

interface NotePublicApiNote {
  status?: string;
  user?: { urlname?: string };
}

/**
 * note の公開 API (`GET /api/v3/notes/<noteId>`、認証不要) から `status`/`user.urlname` を取得する。
 * 「投稿する」後は本文ページへ遷移しないため(`waitForPublishConfirmation` 参照)、公開 URL の確定は
 * URL 遷移監視より本 API を最優先にする(2026-09-18 実測: `status==='published'` と
 * `user.urlname` を安定して取得できることを確認済み)。
 */
async function fetchNotePublicApi(page: Page, noteId: string): Promise<NotePublicApiNote | null> {
  try {
    const resp = await page.request.get(`https://note.com/api/v3/notes/${noteId}`);
    if (!resp.ok()) return null;
    const json = (await resp.json()) as { data?: NotePublicApiNote };
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * 投稿後の公開 URL を確定する。
 *   1. 公開 API (`fetchNotePublicApi`) を最優先 — `status==='published'` かつ `user.urlname` が
 *      取れれば `https://note.com/<urlname>/n/<noteId>` を組み立てる(反映ラグを考慮し数回リトライ)。
 *   2. API が失敗/未反映の場合のみ、URL 遷移(`note.com/<handle>/n/<noteId>`)を補助的に確認する。
 */
async function resolvePublishedUrl(page: Page, noteId: string): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const api = await fetchNotePublicApi(page, noteId);
    if (api?.status === 'published' && api.user?.urlname) {
      return buildNotePublicUrl(api.user.urlname, noteId);
    }
    await page.waitForTimeout(2000);
  }
  for (let i = 0; i < 3; i++) {
    const url = page.url();
    const m = url.match(/note\.com\/([^/]+)\/n\/([a-z0-9]+)/i);
    if (m && m[2] === noteId) return url;
    await page.waitForTimeout(1500);
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
