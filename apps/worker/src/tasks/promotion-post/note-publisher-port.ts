/**
 * F-058 (note) — note.com へのブラウザ自動化 PublisherPort。
 *
 * note は公式投稿 API が無いため、KDP と同様に Playwright でログイン→記事作成→公開する。
 * 認証は env `NOTE_EMAIL`/`NOTE_PASSWORD`(単一運用)。ログインは captcha ブロック無しで通ることを
 * 実地確認済み(reCAPTCHA v3 は不可視・非ブロック)。
 *
 * フロー(実地検証済 2026-08-04):
 *   1. https://note.com/login で email+password ログイン → note.com/ へ遷移
 *   2. https://note.com/notes/new → editor.note.com/notes/<id>/edit/ に新規下書き生成
 *   3. タイトル = textarea[placeholder="記事タイトル"] / 本文 = div[contenteditable=true]
 *   4. 「公開に進む」→ .../publish/ → 「投稿する」で公開
 *
 * HARD RULE: playwright の import はこのファイルに閉じる(evaluate はブラウザ側実行)。
 */
import { createLogger } from '@a2p/contracts/logger';

import type { PublishInput, PublishResult, PublisherPort } from './publisher-port.js';

const log = createLogger('worker.promotion.note-publisher');

const LOGIN_URL = 'https://note.com/login';
const NEW_NOTE_URL = 'https://note.com/notes/new';

export interface NotePublisherDeps {
  /** note ログイン email。既定は env NOTE_EMAIL。 */
  email?: string;
  /** note ログイン password。既定は env NOTE_PASSWORD。 */
  password?: string;
  /** ヘッドレス。既定 true。 */
  headless?: boolean;
}

export function createNotePublisherPort(deps: NotePublisherDeps = {}): PublisherPort {
  const headless = deps.headless ?? true;

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      // 資格情報の優先順位: 明示 deps > UI 保存値(config: メール=note_email / パスワード=token) > env。
      const email =
        deps.email ??
        (typeof input.config.extra?.note_email === 'string' ? (input.config.extra.note_email as string) : '') ??
        process.env.NOTE_EMAIL ??
        '';
      const password = deps.password ?? input.config.token ?? process.env.NOTE_PASSWORD ?? '';
      if (!email || !password) {
        return {
          ok: false,
          reason: 'not_connected',
          message: 'note のメール/パスワード未設定 (接続設定で入力するか NOTE_EMAIL/NOTE_PASSWORD を設定)',
        };
      }
      const title = (input.title ?? '').trim() || firstLine(input.body);
      const body = input.body.trim();
      if (!body) return { ok: false, reason: 'invalid', message: 'empty note body' };

      let chromium: typeof import('playwright').chromium;
      try {
        ({ chromium } = await import('playwright'));
      } catch (err) {
        return { ok: false, reason: 'unknown', message: `playwright unavailable: ${errMsg(err)}` };
      }
      const browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      try {
        // セッション再利用: 住宅IPで取得した note セッションを config から復号して読み込む。
        // worker のデータセンターIP は note ログインで reCAPTCHA を出されるため、ログイン自体を回避する。
        let storageState:
          | Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>
          | undefined;
        const sessEnc =
          typeof input.config.extra?.note_session_enc === 'string'
            ? (input.config.extra.note_session_enc as string)
            : '';
        if (sessEnc) {
          try {
            const { decryptApiKey } = await import('@a2p/crypto');
            storageState = JSON.parse(decryptApiKey(sessEnc));
          } catch {
            /* セッション復号失敗 → ログインにフォールバック */
          }
        }
        const context = await browser.newContext({
          locale: 'ja-JP',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          ...(storageState ? { storageState } : {}),
        });
        // tsx(esbuild keepNames) の __name 未定義対策(KDP port と同じ no-op シム)。
        await context.addInitScript({
          content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
        });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);

        // 1. 新規記事エディタへ直行し、セッションが有効か確認 (有効ならログイン不要=reCAPTCHA回避)。
        await page.goto(NEW_NOTE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(6000);
        let titleEl = await page.$('textarea');

        // 2. エディタが出なければ未ログイン → メール+パスワードでログイン試行。
        //    住宅IPなら成功。データセンターIP(worker)は reCAPTCHA で失敗しうる → セッション再取得が必要。
        if (!titleEl) {
          await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3500);
          const emailEl = await page.$('input[type=email], input[name=email], #email');
          const pwEl = await page.$('input[type=password], #password');
          if (emailEl && pwEl) {
            await emailEl.fill(email);
            await pwEl.fill(password);
            await page.evaluate(() => {
              const b = [...document.querySelectorAll('button,[role=button],input[type=submit]')].find((x) =>
                /ログイン/.test((x as HTMLElement).textContent || (x as HTMLInputElement).value || ''),
              ) as HTMLElement | undefined;
              if (b) b.click();
            });
            await page.waitForTimeout(6000);
          }
          const loggedIn = await page.evaluate(
            () => !/\/login/.test(location.pathname) && !/メールアドレスまたはパスワード|正しくありません/.test(document.body.textContent || ''),
          );
          if (!loggedIn) {
            const failUrl = page.url();
            const snippet = await page
              .evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160))
              .catch(() => '');
            let shotKey = '';
            try {
              const buf = await page.screenshot();
              const storage = await import('@a2p/storage/operations');
              shotKey = `debug/note/login-fail-${Date.now()}.png`;
              await storage.uploadBuffer(shotKey, buf, 'image/png');
            } catch {
              /* best effort */
            }
            log.warn({ failUrl, shotKey, snippet, hadSession: !!storageState }, 'note login failed (reCAPTCHA on datacenter IP?)');
            return {
              ok: false,
              reason: 'auth',
              message: `note login failed (要セッション再取得) url=${failUrl} shot=${shotKey} :: ${snippet}`.slice(0, 480),
            };
          }
          await page.goto(NEW_NOTE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(6000);
          titleEl = await page.$('textarea');
        }

        const bodyEl = await page.$('div[contenteditable=true]');
        if (!titleEl || !bodyEl) {
          return { ok: false, reason: 'unknown', message: 'note editor not ready (title/body not found)' };
        }

        // 2.5 アイキャッチ画像 (mediaUrls[0]) をアップロード。book=表紙入り販促画像 / value=バリューカード。
        //     「画像を追加」→「画像をアップロード」(filechooser)→ トリミングモーダル →「保存」。
        const mediaUrl = input.mediaUrls?.[0];
        if (mediaUrl) {
          try {
            const res = await fetch(mediaUrl);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              await page.click('[aria-label="画像を追加"]').catch(() => {});
              await page.waitForTimeout(1800);
              const [fc] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 15000 }),
                page.getByText('画像をアップロード', { exact: false }).click(),
              ]);
              await fc.setFiles({ name: 'eyecatch.jpg', mimeType: 'image/jpeg', buffer: buf });
              // トリミング/位置調整モーダルの「保存」を押す(「下書き保存」とは別物なので厳密一致)。
              await page.waitForSelector('text=保存', { timeout: 20000 }).catch(() => {});
              await page.waitForTimeout(2500);
              const savedEye = await page.evaluate(() => {
                const el = [...document.querySelectorAll('button,[role=button]')].find(
                  (x) => (x as HTMLElement).getClientRects().length > 0 && ((x as HTMLElement).textContent || '').trim() === '保存',
                ) as HTMLElement | undefined;
                if (el) {
                  el.click();
                  return true;
                }
                return false;
              });
              await page.waitForTimeout(3500);
              log.info({ savedEye }, 'note eyecatch uploaded');
            }
          } catch (e) {
            log.warn({ err: errMsg(e) }, 'note eyecatch upload failed — continue without');
          }
        }

        // 3. タイトル + 本文入力
        await titleEl.click();
        await titleEl.type(title.slice(0, 100), { delay: 8 });
        await bodyEl.click();
        await page.keyboard.type(body, { delay: 3 });
        await page.waitForTimeout(1500);

        // 4. 公開に進む
        const proceeded = await clickByText(page, /公開に進む/);
        if (!proceeded) return { ok: false, reason: 'unknown', message: '「公開に進む」ボタンが見つかりません' };
        await page.waitForSelector('text=投稿する', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);

        // 5. 投稿する(公開)
        const published = await clickByText(page, /^投稿する$/);
        if (!published) {
          return { ok: false, reason: 'unknown', message: '「投稿する」ボタンが見つかりません' };
        }
        await page.waitForTimeout(6000);

        // 6. 公開後 URL を取得。公開直後は .../notes/<id>/first_post(初投稿) や .../publish(共有画面) に
        //    遷移する。location から note id を拾い、解決可能な記事 URL を組み立てる。
        const url = await page.evaluate(() => {
          // 自分の記事キーは publish/first_post の URL (…/notes/<key>/…) に含まれる。これを最優先。
          const m = location.href.match(/\/notes\/(n[a-z0-9]+)/);
          if (m) return `https://note.com/notes/${m[1]}`;
          // フォールバック: ページ内リンク。ただし note 公式(info)のお知らせリンクは除外する。
          const canon = ([...document.querySelectorAll('a[href*="/n/n"]')] as HTMLAnchorElement[])
            .map((a) => a.href)
            .find((h) => !/note\.com\/info\//.test(h));
          return canon ?? null;
        });
        log.info({ url }, 'note published');
        return { ok: true, externalUrl: url };
      } catch (err) {
        return { ok: false, reason: 'unknown', message: errMsg(err) };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}

async function clickByText(page: import('playwright').Page, re: RegExp): Promise<boolean> {
  return page
    .evaluate((src: string) => {
      const rx = new RegExp(src);
      const el = [...document.querySelectorAll('button,[role=button],a')].find(
        (x) => (x as HTMLElement).offsetParent !== null && rx.test(((x as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim()),
      ) as HTMLElement | undefined;
      if (el) {
        el.click();
        return true;
      }
      return false;
    }, re.source)
    .catch(() => false);
}

function firstLine(s: string): string {
  return (s.split('\n')[0] || 'note').replace(/^#+\s*/, '').slice(0, 60);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
