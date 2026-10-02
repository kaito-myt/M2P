/**
 * ペーパーバックの**下書き作成**をサーバー側 (Railway) で実行する Playwright ポート (F-097f)。
 *
 * 運営者指示 (2026-09-29)「ペーパーバックの下書き作成についてもローカルではなくてサーバー側で
 * やってって言ったよね？基本すべての作業をサーバー側でやってほしいのですよ」。
 * ローカル専用だった `scripts/paperback/pb-pilot.mjs` の実績フローをそのまま移植する
 * （出版側の `paperback-submit/playwright-paperback-port.ts` と同じ土俵に載せる）。
 *
 * 違いは 2 点だけ:
 *   - 永続 Chrome プロファイル (`scripts/.kdp-userdata`, headless:false) ではなく
 *     **storageState + パスワード/TOTP 再認証**を使う（出版側で実績がある）。
 *   - 画面ダンプの代わりに、失敗時だけ R2 `debug/paperback-draft/` にスクショを残す。
 *
 * フロー (すべて実測ベース。日付は実地確認日):
 *   0. 本棚で ASIN を検索し、その行の「ペーパーバックの作成」を押す
 *      (行を特定できないときは**押さない**。先頭行フォールバックは他書籍の PB を作る事故 2026-09-03)
 *   1. カテゴリー (必須・Kindle から引き継がれない) を kdp_metadata のカテゴリから流用
 *   2. 「保存して続行」→ content へ
 *   3. 無料 KDP ISBN を取得 → 印刷オプション (BW_WHITE / 裁ち落としなし / MATTE / 左→右)
 *      → 判型 A5 (148×210) → 原稿 PDF と表紙 PDF をアップロード → 変換完了を待つ
 *      → AI コンテンツ質問は「いいえ」(運営者方針)
 *   4. URL から titleId を取り出して返す（**出版はしない**。承認と出版は paperback.submit の仕事）
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。
 */
import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';
import { passKdpReauth } from '../kdp-submit/playwright-publish-port.js';
import type { OtpProvider } from '../kdp-submit/totp.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

const log = createLogger('worker.paperback-draft.playwright');

const BASE = 'https://kdp.amazon.co.jp';
/** KDP の作成数上限モーダル。出たら即座に打ち切る（叩き続けても無駄なので）。 */
const CREATION_LIMIT_RE = /本の作成数制限|本の作成数上限|提出可能な本の数を超え/;

/**
 * Kindle のカテゴリ木のトップ → ペーパーバックのカテゴリ木のトップ対応表。
 * 紙書籍は独自分類なので、そのままでは一致しない（2026-09-03 実測）。
 */
const PB_TOP_MAP: Record<string, string> = {
  '健康・フィットネス': '暮らし・健康・子育て',
  自己啓発: '人文・思想',
  'ビジネス・経済': 'ビジネス・経済',
  '投資・金融': '投資・金融・会社経営',
  '文学・評論': '文学・評論',
  ライトノベル: 'コミック・ラノベ・BL',
  '趣味・実用': '趣味・実用',
  スポーツ: 'スポーツ・アウトドア',
  '教育・学参': '教育・学参・受験',
};

export interface PaperbackDraftArgs {
  /** ログ用。 */
  bookId: string;
  /** 本棚で行を特定するための Kindle 版 ASIN。 */
  asin: string;
  /**
   * 本棚の検索窓は **「タイトルで検索」** で ASIN では引けない (2026-09-29 実測。
   * ASIN を入れると「結果が見つかりません」になる)。検索はタイトルで行い、
   * 行の特定は ASIN で照合する。
   */
  title: string;
  /** Kindle のカテゴリパス (「Kindle本 > ... 」形式)。最大 3 本流用する。 */
  categoryPaths: string[];
  /** 本文 PDF のローカルパス。 */
  interiorPath: string;
  /** ラップカバー PDF のローカルパス。 */
  coverPath: string;
  /** 復号済み storageState (JSON 文字列)。 */
  sessionState: string;
  /** 再認証で使うアカウントのメールアドレス (アカウントピッカーの選択にも使う)。 */
  email?: string | null;
  password: string;
  /**
   * OTP プロバイダ (TOTP or LINE リレー)。`kdp.submit` と同じものを渡す。
   * 本棚から入ると**メール入力から始まる完全サインイン**になることがあり、
   * 生の TOTP だけでは通らない (2026-09-29 実測)。
   */
  otp: OtpProvider;
  /**
   * [F-097k] 下書きが**採番された瞬間**に呼ばれる。ここで titleId を DB に保存しておかないと、
   * この後の長いアップロード中に worker が落ちたとき (= デプロイ) に
   * **KDP 上には下書きがあるのに DB は何も知らない**状態になり、本棚にはもう
   * 「ペーパーバックの作成」が出ないのでその本が二度と進まなくなる (2026-10-02 実測)。
   */
  onTitleId?: (titleId: string) => Promise<void>;
  /**
   * [F-097k] 既に採番済みの下書きを再開する。指定時は本棚と詳細ページ (STEP0/STEP1) を飛ばし、
   * その titleId のコンテンツページから再開する。
   */
  resumeTitleId?: string | null;
}

export type PaperbackDraftResult =
  | { ok: true; titleId: string; isbn: string | null }
  | {
      ok: false;
      reason:
        | 'not_logged_in'
        | 'reauth_failed'
        | 'creation_limit'
        | 'no_create_button'
        | 'step1_error'
        | 'no_title_id'
        | 'upload_failed'
        | 'error';
      message: string;
    };

export interface PaperbackDraftPort {
  createDraft(args: PaperbackDraftArgs): Promise<PaperbackDraftResult>;
}

export function createPlaywrightPaperbackDraftPort(): PaperbackDraftPort {
  return { createDraft };
}

/** Kindle のカテゴリパスから、ペーパーバック用のセグメント列を作る。 */
export function toPaperbackCategorySegments(categoryPaths: readonly string[]): string[][] {
  return categoryPaths
    .slice(0, 3)
    .map((p) => {
      const segs = String(p)
        .split('>')
        .map((s) => s.trim())
        .filter(Boolean);
      const i = segs.findIndex((x) => x.replace(/\s/g, '') === 'Kindle本');
      const raw = i >= 0 ? segs.slice(i + 1) : segs;
      if (raw.length === 0) return [];
      return [PB_TOP_MAP[raw[0]!] ?? raw[0]!, ...raw.slice(1)];
    })
    .filter((l) => l.length > 0);
}

/** URL から print-setup の titleId を取り出す。 */
export function extractTitleId(url: string): string | null {
  const m = /print-setup\/paperback\/([A-Z0-9]+)/i.exec(url);
  return m ? m[1]! : null;
}

async function createDraft(args: PaperbackDraftArgs): Promise<PaperbackDraftResult> {
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
      viewport: { width: 1760, height: 1200 },
    });
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('dialog', (d: any) => {
      void d.accept().catch(() => {});
    });

    const shot = async (name: string): Promise<void> => {
      let buf: Buffer | null = null;
      try {
        buf = await page.screenshot({ fullPage: true });
      } catch {
        return;
      }
      if (!buf) return;
      try {
        const mod = await import('@a2p/storage');
        const key = `debug/paperback-draft/${args.bookId}-${name}-${String(Date.now())}.png`;
        await mod.uploadBuffer(key, buf, 'image/png');
        log.info({ key }, 'saved paperback-draft debug shot');
      } catch {
        /* best-effort */
      }
    };

    /**
     * 再認証ウォール。**`kdp.submit` の実績ある実装をそのまま使う**
     * (アカウントピッカー → パスワード → OTP)。自前の簡易版は本棚から入ったときの
     * 完全サインイン (メール入力から) に負け、`reauth_failed` で止まっていた
     * — 2026-09-29 実測。スクショで「このEメールアドレスを持つアカウントが
     * 見つかりません」を確認済み。
     */
    const passReauth = async (label: string): Promise<boolean> => {
      const ok = await passKdpReauth(page, {
        amazonEmail: args.email ?? undefined,
        amazonPassword: args.password,
        otp: args.otp,
      }).catch(() => false);
      if (!ok) log.warn({ label, bookId: args.bookId, url: page.url().slice(0, 110) }, 'kdp reauth failed');
      return ok;
    };

    /**
     * 作成数上限モーダルの検出。**可視のリーフ要素に限定**する
     * (隠しテンプレの文言で誤検知した実績があるため — 2026-09-02)。
     */
    const hitCreationLimit = async (): Promise<boolean> => {
      return page
        .evaluate((src: string) => {
          const re = new RegExp(src);
          return [...document.querySelectorAll('*')].some(
            (el) =>
              ((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight) &&
              el.children.length === 0 &&
              re.test(el.textContent ?? ''),
          );
        }, CREATION_LIMIT_RE.source)
        .catch(() => false);
    };

    // [F-097k] 既に採番済みの下書きがあるなら本棚からやり直さない (作成枠も消費しない)。
    let resumedTitleId: string | null = null;
    if (args.resumeTitleId) {
      await page
        .goto(`${BASE}/print-setup/paperback/${args.resumeTitleId}/content`, { waitUntil: 'domcontentloaded' })
        .catch(() => {});
      await page.waitForTimeout(6000);
      if (!(await passReauth('resume'))) {
        await shot('resume-reauth-failed');
        return { ok: false, reason: 'reauth_failed', message: '下書き再開時に再認証できませんでした' };
      }
      if (extractTitleId(page.url()) === args.resumeTitleId) {
        resumedTitleId = args.resumeTitleId;
        log.info({ bookId: args.bookId, titleId: resumedTitleId }, 'paperback draft resumed');
      } else {
        log.warn(
          { bookId: args.bookId, titleId: args.resumeTitleId, url: page.url().slice(0, 110) },
          '下書きを再開できなかったので本棚からやり直す',
        );
      }
    }

    // --- STEP0: 本棚 → 「ペーパーバックの作成」 ---
    if (!resumedTitleId) {
    await page.goto(`${BASE}/ja_JP/bookshelf`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    if (!(await passReauth('bookshelf'))) {
      await shot('reauth-failed');
      return { ok: false, reason: 'reauth_failed', message: '本棚で再認証できませんでした' };
    }
    if (/signin/i.test(page.url())) {
      return { ok: false, reason: 'not_logged_in', message: `未ログイン (url=${page.url().slice(0, 90)})` };
    }

    // 表示ビューを「すべてのタイトル」にする。既定の「本」ビューには**一部の本しか出ない**
    // (2026-09-29 実測: 2 ページ 114 行を走査しても対象 ASIN が 1 件も出てこなかった。
    //  KDP 自身も「アーカイブ済みの本を検索結果に含めるには、すべてのタイトル ビューを
    //  使用します」と案内している)。
    const viewSwitched = await page
      .evaluate(() => {
        for (const sel of [...document.querySelectorAll('select')] as HTMLSelectElement[]) {
          const opts = [...sel.options];
          const all = opts.find((o) => /すべてのタイトル|All titles/i.test(o.textContent ?? ''));
          if (!all) continue;
          if (sel.value === all.value) return 'already';
          sel.value = all.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return (all.textContent ?? '').trim();
        }
        return null;
      })
      .catch(() => null);
    if (viewSwitched) await page.waitForTimeout(7000);
    log.info({ bookId: args.bookId, viewSwitched }, 'paperback bookshelf view');

    // 一覧を最大件数/ページにしてから、**ASIN でページを走査**する。
    // 検索窓は「タイトルで検索」で、DB のタイトルと KDP 上の表記が違うと 0 件になるため
    // 検索には頼らない (2026-09-29 実測)。
    await page
      .evaluate(() => {
        const sel = [...document.querySelectorAll('select')].find((x) =>
          /冊\/ページ|per page/.test(x.options[x.selectedIndex]?.textContent ?? ''),
        ) as HTMLSelectElement | undefined;
        if (!sel) return null;
        let best: { v: string; n: number } | null = null;
        for (const o of sel.options) {
          const n = Number((o.textContent ?? '').replace(/[^0-9]/g, ''));
          if (Number.isFinite(n) && n > 0 && (!best || n > best.n)) best = { v: o.value, n };
        }
        if (!best) return null;
        sel.value = best.v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return best.n;
      })
      .catch(() => null);
    await page.waitForTimeout(6000);

    /**
     * 現在のページで ASIN の行を探し、「ペーパーバックの作成」を押す。
     * 戻り値: 'clicked' | 'exists'(既にペーパーバックあり) | 'absent'(この頁に無い)
     */
    const clickCreateForAsin = async (): Promise<'clicked' | 'exists' | 'absent'> => {
      return page
        .evaluate((asin: string) => {
          // ASIN を含む要素のうち**最も小さいもの**を起点にする。
          // 葉要素だけを見る方式だと、テキストが入れ子になっている行を取りこぼす
          // (2026-09-30 実測: 本棚に出ているのに absent になっていた)。
          const holders = ([...document.querySelectorAll('*')] as HTMLElement[]).filter((el) =>
            (el.textContent ?? '').includes(asin),
          );
          if (holders.length === 0) return 'absent';
          holders.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

          for (const start of holders.slice(0, 5)) {
            let row: HTMLElement | null = start;
            for (let i = 0; i < 14 && row; i += 1) {
              // **その行に ASIN が残っていること**を条件にして親を辿る。
              // 条件を付けないと、隣の行のボタンを押してしまう。
              if (!(row.textContent ?? '').includes(asin)) break;
              const btn = [...row.querySelectorAll('a,button,span[role=button]')].find((x) =>
                /ペーパーバックの作成/.test(x.textContent ?? ''),
              ) as HTMLElement | undefined;
              if (btn) {
                btn.click();
                return 'clicked';
              }
              row = row.parentElement;
            }
          }
          // ASIN はあるが作成ボタンが無い = 既にペーパーバックが紐づいている。
          return 'exists';
        }, args.asin)
        .catch(() => 'absent' as const);
    };

    /** いま何行出ていて、ASIN が本文に含まれるか (診断用)。 */
    const pageStats = async (): Promise<{ rows: number; hasAsin: boolean; pages: string }> => {
      return page
        .evaluate((asin: string) => {
          const body = document.body.innerText || '';
          const rows = (body.match(/ASIN:/g) ?? []).length;
          const nums = [...document.querySelectorAll('a,button,li')]
            .map((x) => (x.textContent ?? '').trim())
            .filter((t) => /^\d{1,2}$/.test(t))
            .slice(0, 15)
            .join(',');
          return { rows, hasAsin: body.includes(asin), pages: nums };
        }, args.asin)
        .catch(() => ({ rows: 0, hasAsin: false, pages: '' }));
    };

    /**
     * 次のページへ。ページ番号のリンクを順に押す方式にする
     * (「›」だけを見る方式は要素が一致せず 1 ページ目から進めなかった — 2026-09-29 実測)。
     */
    const goToPage = async (n: number): Promise<boolean> => {
      const moved = await page
        .evaluate((target: string) => {
          const cands = [...document.querySelectorAll('a,button,li,span')].filter((x) => {
            const t = (x.textContent ?? '').trim();
            return t === target && ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight);
          }) as HTMLElement[];
          if (cands.length === 0) return false;
          cands[cands.length - 1]!.click();
          return true;
        }, String(n))
        .catch(() => false);
      if (moved) await page.waitForTimeout(6000);
      return moved;
    };

    let found: 'clicked' | 'exists' | 'absent' = 'absent';
    for (let pageNo = 1; pageNo <= 12; pageNo += 1) {
      const stats = await pageStats();
      log.info({ bookId: args.bookId, asin: args.asin, pageNo, ...stats }, 'paperback bookshelf scan');
      found = await clickCreateForAsin();
      if (found !== 'absent') break;
      if (!(await goToPage(pageNo + 1))) break;
    }

    if (found === 'exists') {
      await shot('already-has-paperback');
      return {
        ok: false,
        reason: 'no_create_button',
        message: `ASIN=${args.asin} は既にペーパーバックが紐づいています (本棚に「ペーパーバックの作成」が無い)`,
      };
    }
    if (found !== 'clicked') {
      await shot('no-create-button');
      return {
        ok: false,
        reason: 'no_create_button',
        message: `本棚で ASIN=${args.asin} の行を見つけられませんでした (title=${args.title.slice(0, 20)})`,
      };
    }

    await page.waitForTimeout(9000);
    if (await hitCreationLimit()) {
      await shot('creation-limit');
      return { ok: false, reason: 'creation_limit', message: 'KDP の本の作成数上限に達しています' };
    }

    // --- STEP1a: カテゴリー (必須) ---
    const segLists = toPaperbackCategorySegments(args.categoryPaths);
    const lists = segLists.length > 0 ? segLists : [['趣味・実用']];
    const catBtn = await page.$('#categories-modal-button').catch(() => null);
    if (catBtn) {
      await catBtn.click().catch(() => {});
      await page.waitForTimeout(3500);
      const SCOPE = '[role=dialog], .a-popover:not([style*="display: none"]), .a-modal-scroller';

      /** モーダル内の未選択 select に、セグメント名でファジー選択する。 */
      const fuzzyPick = async (seg: string): Promise<{ picked?: string; err?: string }> => {
        for (let a = 0; a < 4; a += 1) {
          const res = await page
            .evaluate(
              ({ scope, target }: { scope: string; target: string }) => {
                const dlg =
                  document.querySelector(scope.split(',')[0]!.trim()) ??
                  document.querySelector('.a-popover:not([style*="display: none"])') ??
                  document.querySelector('.a-modal-scroller');
                if (!dlg) return { err: 'no-dialog' };
                const sels = [...dlg.querySelectorAll('select')].filter(
                  (s) => (s as HTMLElement).offsetWidth || (s as HTMLElement).offsetHeight,
                ) as HTMLSelectElement[];
                const score = (opt: string): number => {
                  const t = opt.trim();
                  if (!t || /^1 つ選択/.test(t)) return -1;
                  if (t === target) return 100;
                  if (t.includes(target) || target.includes(t)) return 80;
                  let ov = 0;
                  for (const ch of new Set(target)) if (t.includes(ch)) ov += 1;
                  return (ov / Math.max(3, target.length)) * 60;
                };
                for (const s of sels) {
                  const cur = s.options[s.selectedIndex]?.textContent?.trim() ?? '';
                  if (cur && !/^1 つ選択/.test(cur)) continue;
                  let best: { sc: number; label: string; value: string } | null = null;
                  for (const o of s.options) {
                    const sc = score(o.textContent ?? '');
                    if (sc > 20 && (!best || sc > best.sc)) {
                      best = { sc, label: (o.textContent ?? '').trim(), value: o.value };
                    }
                  }
                  if (best) {
                    s.value = best.value;
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    return { picked: best.label };
                  }
                  return { err: 'no-option-for:' + target };
                }
                return { err: 'no-open-select' };
              },
              { scope: SCOPE, target: seg },
            )
            .catch(() => ({ err: 'evaluate-failed' }));
          if (res.picked) {
            await page.waitForTimeout(1800);
            return res;
          }
          if (res.err === 'no-open-select' || res.err?.startsWith('no-option')) return res;
          await page.waitForTimeout(900);
        }
        return { err: 'timeout' };
      };

      for (let ci = 0; ci < lists.length; ci += 1) {
        if (ci > 0) {
          await page.click('button:has-text("別のカテゴリーを追加")').catch(() => {});
          await page.waitForTimeout(2000);
        }
        const mapped = lists[ci]!;
        for (const seg of mapped) {
          const r = await fuzzyPick(seg);
          if (r.err === 'no-open-select') break;
        }
        // 追加で開いた select が残っていれば末尾セグメントで降りる (最大 3 段)。
        for (let d = 0; d < 3; d += 1) {
          const r = await fuzzyPick(mapped[mapped.length - 1]!);
          if (!r.picked) break;
        }
        // 葉のチェックボックスを 1 つ入れる。
        await page
          .evaluate((scope: string) => {
            const dlg =
              document.querySelector(scope.split(',')[0]!.trim()) ??
              document.querySelector('.a-popover:not([style*="display: none"])') ??
              document.querySelector('.a-modal-scroller');
            if (!dlg) return false;
            const boxes = [...dlg.querySelectorAll('input[type=checkbox]')].filter(
              (c) => ((c as HTMLElement).offsetWidth || (c as HTMLElement).offsetHeight) && !(c as HTMLInputElement).checked,
            );
            if (boxes.length === 0) return false;
            (boxes[0] as HTMLElement).click();
            return true;
          }, SCOPE)
          .catch(() => false);
        await page.waitForTimeout(1200);
      }
      const savedCount = await page
        .evaluate((scope: string) => {
          const dlg =
            document.querySelector(scope.split(',')[0]!.trim()) ??
            document.querySelector('.a-popover:not([style*="display: none"])');
          const cnt = /(\d+) 個のカテゴリーを選択済み/.exec(dlg?.textContent ?? '')?.[1];
          const b = [...(dlg ?? document).querySelectorAll('button')].find((x) =>
            /カテゴリーを保存/.test(x.textContent ?? ''),
          );
          if (b) (b as HTMLElement).click();
          return cnt ?? '?';
        }, SCOPE)
        .catch(() => '?');
      log.info({ bookId: args.bookId, savedCount }, 'paperback categories saved');
      await page.waitForTimeout(3000);
    }

    // --- STEP1: 保存して続行 ---
    await page.click('#save-and-continue-announce').catch(() => {});
    await page.waitForTimeout(12000);
    if (await hitCreationLimit()) {
      await shot('creation-limit-step1');
      return { ok: false, reason: 'creation_limit', message: 'KDP の本の作成数上限に達しています' };
    }
    if (/\/details/.test(page.url())) {
      const errs: string[] = await page
        .evaluate(() =>
          [...document.querySelectorAll('.a-alert-error,.a-box-inner .a-alert-container')]
            .filter((x) => (x as HTMLElement).offsetParent !== null)
            .map((x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200))
            .filter((t) => t && !/placeholder/.test(t)),
        )
        .catch(() => []);
      if (errs.length > 0) {
        await shot('step1-error');
        return { ok: false, reason: 'step1_error', message: `詳細ページでエラー: ${errs.join(' / ').slice(0, 200)}` };
      }
      await page.waitForTimeout(8000);
    }
    await passReauth('after-step1');

    }

    const titleId = resumedTitleId ?? extractTitleId(page.url());
    if (!titleId) {
      await shot('no-title-id');
      return { ok: false, reason: 'no_title_id', message: `titleId を取得できません (url=${page.url().slice(0, 110)})` };
    }
    if (!resumedTitleId) {
      log.info({ bookId: args.bookId, titleId }, 'paperback draft created');
      // **採番直後に保存する**。この先のアップロードは数分かかり、途中で worker が落ちると
      // KDP には下書きがあるのに DB が知らない状態になって詰む。
      if (args.onTitleId) {
        await args.onTitleId(titleId).catch((err: unknown) => {
          log.warn({ bookId: args.bookId, titleId, err: errMsg(err) }, 'titleId の保存に失敗');
        });
      }
    }

    // --- STEP2: ISBN / 印刷オプション / 判型 / アップロード ---
    const isbnClicked = await page
      .evaluate(() => {
        const b = [...document.querySelectorAll('button, input[type=button]')].find((x) =>
          /無料.*ISBN|ISBN.*取得/.test(x.textContent ?? (x as HTMLInputElement).value ?? ''),
        );
        if (!b) return false;
        (b as HTMLElement).click();
        return true;
      })
      .catch(() => false);
    if (isbnClicked) {
      await page.waitForTimeout(4000);
      await page
        .locator('[role=dialog] button, [aria-modal="true"] button')
        .filter({ hasText: /割り当て|取得|確認|はい|OK/ })
        .first()
        .click({ timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(5000);
      // overlay の残骸は以降のクリックを遮るので Escape で掃除する。
      for (let k = 0; k < 2; k += 1) {
        const still = await page
          .evaluate(() =>
            [...document.querySelectorAll('[role=dialog], [aria-modal="true"]')].some(
              (d) => (d as HTMLElement).offsetWidth || (d as HTMLElement).offsetHeight,
            ),
          )
          .catch(() => false);
        if (!still) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    const isbn: string | null = await page
      .evaluate(() => /97[89][-\d]{10,14}/.exec(document.body.textContent ?? '')?.[0] ?? null)
      .catch(() => null);

    // 既定値が全て正解だが (2026-09 実測)、明示的に担保する。
    for (const sel of ['#ink-paper-BW_WHITE', '#bleed-no', '#cover-finish-MATTE', '#page-turn-direction-left-to-right']) {
      await page.check(sel, { force: true }).catch(() => {});
    }

    // 判型 A5 (148×210)。UI が role=button のことがあるので広く探す。
    const trimOpened = await page
      .evaluate(() => {
        const c = [...document.querySelectorAll('button,[role=button],a')].find(
          (x) => /判型/.test(x.textContent ?? '') && ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
        );
        if (!c) return false;
        (c as HTMLElement).click();
        return true;
      })
      .catch(() => false);
    if (trimOpened) {
      await page.waitForTimeout(3000);
      await page
        .evaluate(() => {
          const c = [...document.querySelectorAll('[role=dialog] *, .a-popover *')].find(
            (x) =>
              /148\s*(mm)?\s*[x×]\s*210|A5/.test(x.textContent ?? '') &&
              x.children.length <= 1 &&
              ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
          );
          if (c) (c as HTMLElement).click();
        })
        .catch(() => {});
      await page.waitForTimeout(1500);
      await page
        .evaluate(() => {
          const b = [...document.querySelectorAll('[role=dialog] button, .a-popover button')].find((x) =>
            /選択|適用|OK|保存|更新/.test(x.textContent ?? ''),
          );
          if (b) (b as HTMLElement).click();
        })
        .catch(() => {});
      await page.waitForTimeout(3000);
    }

    /** 「原稿/表紙をアップロード」ボタン → filechooser。取れないときは隠し input に直投入。 */
    const uploadVia = async (labelRe: string, file: string, fallbackIdx: number): Promise<boolean> => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
      const handle = await page
        .evaluateHandle(
          (re: string) =>
            [...document.querySelectorAll('button,[role=button]')].find(
              (x) =>
                new RegExp(re).test(x.textContent ?? '') &&
                ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
            ) ?? null,
          labelRe,
        )
        .catch(() => null);
      const el = handle ? handle.asElement() : null;
      if (!el) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > fallbackIdx) {
          await inputs[fallbackIdx].setInputFiles(file).catch(() => {});
          return true;
        }
        return false;
      }
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
        el.click({ timeout: 15000 }).catch(() => {}),
      ]);
      if (!fc) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > fallbackIdx) {
          await inputs[fallbackIdx].setInputFiles(file).catch(() => {});
          return true;
        }
        return false;
      }
      await fc.setFiles(file);
      return true;
    };

    const interiorOk = await uploadVia('原稿をアップロード', args.interiorPath, 0);
    await page.waitForTimeout(4000);
    const coverOk = await uploadVia('表紙ファイルをアップロード', args.coverPath, 1);
    if (!interiorOk || !coverOk) {
      await shot('upload-button-missing');
      return {
        ok: false,
        reason: 'upload_failed',
        message: `アップロードボタンが見つかりません (原稿=${String(interiorOk)} 表紙=${String(coverOk)})`,
      };
    }

    // 変換待ち (最大 12 分)。
    let uploadedBoth = false;
    for (let i = 0; i < 72; i += 1) {
      await page.waitForTimeout(10000);
      const t: string = await page.evaluate(() => document.body.textContent ?? '').catch(() => '');
      const ok = (t.match(/正常にアップロードしました|アップロードに成功|処理が完了しました/g) ?? []).length;
      if (/アップロードで問題|アップロードに失敗|エラーが発生|問題が見つかりました/.test(t)) {
        await shot('upload-error');
        return { ok: false, reason: 'upload_failed', message: 'KDP がアップロードの問題を報告しました' };
      }
      if (ok >= 2) {
        uploadedBoth = true;
        break;
      }
    }
    log.info({ bookId: args.bookId, titleId, uploadedBoth, isbn }, 'paperback draft uploads done');

    // AI コンテンツ質問は「いいえ」(Kindle 版と同じ運営者方針)。
    await page.check('input[name="has-ai-content"][value="no"]', { force: true }).catch(() => {});
    // 下書きとして保存して抜ける (**出版はしない**)。
    await page
      .evaluate(() => {
        const b = [...document.querySelectorAll('button,[role=button]')].find((x) =>
          /下書きとして保存|下書きを保存/.test(x.textContent ?? ''),
        );
        if (b) (b as HTMLElement).click();
      })
      .catch(() => {});
    await page.waitForTimeout(8000);

    return { ok: true, titleId, isbn };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
