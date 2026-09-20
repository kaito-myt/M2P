/**
 * Amazon Advertising API — LwA(Login with Amazon) OAuth ヘルパー (F-090拡張)。
 *
 * 運営者(人間)がローカル PC で 1 回だけ実行し、Railway の A2P-Worker に設定すべき
 * 5 つの env (AMAZON_ADS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _PROFILE_ID / _REGION)
 * を得るためのスクリプト。worker 本体 (apps/worker) からは呼ばれない、運営者用の使い捨てツール。
 *
 * 事前準備 (Amazon Advertising Console):
 *   1. https://advertising.amazon.com/API/docs の手順で LwA セキュリティプロファイルを作成し
 *      Client ID / Client Secret を発行する。
 *   2. セキュリティプロファイルの「許可された返信 URL」に
 *      `http://localhost:8787/callback` (または --port で指定したポート) を追加する。
 *      https のみと書かれているページもあるが、localhost/127.0.0.1 の http は開発用に許可される。
 *      もし LwA コンソールが拒否する場合は --redirect-url / --code オプションで手動投入すること。
 *
 * 使い方:
 *   node scripts/ads/amazon-ads-oauth.mjs --client-id=amzn1.application-oa2-client.xxxx \
 *     --client-secret=xxxx [--region=fe] [--port=8787]
 *
 *   1. 認可 URL が表示されるのでブラウザで開き、Amazon Ads アカウントでログイン・許可する。
 *   2. 自動的にコールバックを受け取れれば refresh_token 交換まで自動で進む。
 *   3. ローカルでコールバックを受け取れない場合 (別マシンで認可した等) は、
 *      リダイレクト後のブラウザ URL 全体を --redirect-url="http://localhost:8787/callback?code=...&state=..."
 *      として渡すか、code だけを --code=... として渡す。
 *   4. 対象広告アカウント(プロファイル)一覧が表示される。KDP 著者アカウントは
 *      accountInfo.subType が "KDP_AUTHOR" になる想定 (要実データ確認)。
 *   5. 最後に Railway に設定すべき 5 env が `KEY=VALUE` 形式で表示される。
 *      --railway-set を付けると `railway variables --service A2P-Worker --set ...` を実行する
 *      (Railway CLI がログイン済み・プロジェクトにリンク済みであること)。
 *
 * 参考: docs/05-program-design.md「Amazon Ads API の事実」節。
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// region ごとのエンドポイント (docs/05 参照)
// ---------------------------------------------------------------------------

const AUTH_HOSTS = {
  na: 'https://www.amazon.com/ap/oa',
  eu: 'https://eu.account.amazon.com/ap/oa',
  fe: 'https://apac.account.amazon.com/ap/oa', // 日本
};
const TOKEN_HOSTS = {
  na: 'https://api.amazon.com/auth/o2/token',
  eu: 'https://api.amazon.co.uk/auth/o2/token',
  fe: 'https://api.amazon.co.jp/auth/o2/token', // 日本
};
const TOKEN_URL_FALLBACK = 'https://api.amazon.com/auth/o2/token';
const ADS_API_HOSTS = {
  na: 'advertising-api.amazon.com',
  eu: 'advertising-api-eu.amazon.com',
  fe: 'advertising-api-fe.amazon.com',
};

const SCOPE = 'advertising::campaign_management';

// ---------------------------------------------------------------------------
// CLI 引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (!m) continue;
    out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const clientId = args['client-id'];
const clientSecret = args['client-secret'];
const region = (args.region ?? 'fe').toLowerCase();
const port = Number(args.port ?? 8787);
const railwaySet = args['railway-set'] === 'true';

if (!clientId || !clientSecret) {
  console.error('[amazon-ads-oauth] --client-id と --client-secret は必須です。');
  console.error('  例) node scripts/ads/amazon-ads-oauth.mjs --client-id=amzn1.application-oa2-client.xxx --client-secret=xxx');
  process.exit(1);
}
if (!AUTH_HOSTS[region]) {
  console.error(`[amazon-ads-oauth] 未対応の region: ${region} (na|eu|fe のいずれか)`);
  process.exit(1);
}

const redirectUri = `http://localhost:${port}/callback`;

function mask(secret) {
  if (!secret) return '(empty)';
  return secret.length <= 8 ? `${secret.slice(0, 2)}…` : `${secret.slice(0, 6)}…(${secret.length} chars)`;
}

function log(...a) {
  console.log('[amazon-ads-oauth]', ...a);
}

// ---------------------------------------------------------------------------
// Step 1: 認可 URL を表示
// ---------------------------------------------------------------------------

const state = crypto.randomBytes(16).toString('hex');

function buildAuthorizeUrl() {
  const url = new URL(AUTH_HOSTS[region]);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

const authorizeUrl = buildAuthorizeUrl();

log('client_id       :', mask(clientId));
log('client_secret   :', mask(clientSecret));
log('region          :', region);
log('redirect_uri    :', redirectUri);
log('');
log('以下の URL をブラウザで開き、Amazon Ads アカウントでログイン・許可してください:');
log('');
console.log(authorizeUrl);
log('');

// ---------------------------------------------------------------------------
// Step 2: 認可コードの取得 (ローカルサーバ待ち受け / --redirect-url / --code)
// ---------------------------------------------------------------------------

function extractCodeFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  return { code, returnedState, error };
}

async function waitForCallback() {
  if (args.code) {
    log('--code が指定されたのでローカルサーバは起動せずそれを使用します。');
    return args.code;
  }
  if (args['redirect-url']) {
    const { code, returnedState, error } = extractCodeFromUrl(args['redirect-url']);
    if (error) throw new Error(`Amazon が認可を拒否しました: ${error}`);
    if (!code) throw new Error('--redirect-url に code パラメータが見つかりません');
    if (returnedState && returnedState !== state) {
      log('警告: state が一致しません(別セッションの可能性)。続行しますが確認してください。');
    }
    return code;
  }

  log(`ローカルサーバ (http://localhost:${port}/callback) でコールバック待機中... (Ctrl+C で中断)`);
  log('別マシン/ブラウザで認可した場合は Ctrl+C で中断し、--redirect-url="<リダイレクト後のURL>" を渡してください。');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const full = `http://localhost:${port}${req.url}`;
      const { code, returnedState, error } = extractCodeFromUrl(full);
      if (error) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<h1>認可エラー</h1><p>${error}</p><p>ターミナルに戻ってください。</p>`);
        server.close();
        reject(new Error(`Amazon が認可を拒否しました: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400).end('code missing');
        return;
      }
      if (returnedState && returnedState !== state) {
        log('警告: state が一致しません(別セッションの可能性)。続行しますが確認してください。');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>認可が完了しました</h1><p>このタブは閉じて、ターミナルに戻ってください。</p>');
      server.close();
      resolve(code);
    });
    server.on('error', (err) => reject(err));
    server.listen(port);
  });
}

// ---------------------------------------------------------------------------
// Step 3: authorization_code → refresh_token 交換
// ---------------------------------------------------------------------------

async function requestToken(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  return { ok: res.ok && !!json.access_token, status: res.status, json };
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const primaryUrl = TOKEN_HOSTS[region];
  let result = await requestToken(primaryUrl, body).catch((err) => ({ ok: false, status: 0, json: { error_description: String(err) } }));
  if (!result.ok && primaryUrl !== TOKEN_URL_FALLBACK) {
    log(`region 別トークン URL (${primaryUrl}) が失敗したため api.amazon.com へフォールバックします。`);
    result = await requestToken(TOKEN_URL_FALLBACK, body).catch((err) => ({ ok: false, status: 0, json: { error_description: String(err) } }));
  }
  if (!result.ok) {
    throw new Error(`トークン交換に失敗しました (${result.status}): ${result.json.error_description ?? JSON.stringify(result.json)}`);
  }
  return result.json; // { access_token, refresh_token, token_type, expires_in }
}

// ---------------------------------------------------------------------------
// Step 4: プロファイル一覧取得
// ---------------------------------------------------------------------------

async function fetchProfiles(accessToken) {
  const host = ADS_API_HOSTS[region];
  const res = await fetch(`https://${host}/v2/profiles`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /v2/profiles failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  const code = await waitForCallback();
  log('認可コードを取得しました。トークン交換中...');

  const tokens = await exchangeCodeForTokens(code);
  log('トークン交換に成功しました。');
  log('access_token  :', mask(tokens.access_token));
  log('refresh_token :', mask(tokens.refresh_token));

  log('');
  log('プロファイル一覧を取得中...');
  const profiles = await fetchProfiles(tokens.access_token);
  if (!Array.isArray(profiles) || profiles.length === 0) {
    log('プロファイルが 0 件でした。Amazon Ads アカウントに広告アカウントが無い可能性があります。');
    process.exit(1);
  }

  log('');
  log('=== 広告アカウント(プロファイル)一覧 ===');
  for (const p of profiles) {
    log(
      `profileId=${p.profileId}  country=${p.countryCode}  currency=${p.currencyCode}  ` +
        `type=${p.accountInfo?.type ?? '?'}  subType=${p.accountInfo?.subType ?? '?'}  name=${p.accountInfo?.name ?? '?'}`,
    );
  }

  const explicitProfileId = args['profile-id'];
  const chosen =
    (explicitProfileId && profiles.find((p) => String(p.profileId) === String(explicitProfileId))) ||
    (profiles.length === 1 ? profiles[0] : null);

  if (!chosen) {
    log('');
    log('複数の広告アカウントが見つかりました。--profile-id=<profileId> を指定して再実行し、');
    log('AMAZON_ADS_PROFILE_ID に使う対象を確定してください(通常は KDP_AUTHOR の日本マーケットプレイス)。');
    process.exit(0);
  }

  log('');
  log(`選択されたプロファイル: profileId=${chosen.profileId} (${chosen.accountInfo?.name ?? '?'})`);

  const envLines = [
    `AMAZON_ADS_CLIENT_ID=${clientId}`,
    `AMAZON_ADS_CLIENT_SECRET=${clientSecret}`,
    `AMAZON_ADS_REFRESH_TOKEN=${tokens.refresh_token}`,
    `AMAZON_ADS_PROFILE_ID=${chosen.profileId}`,
    `AMAZON_ADS_REGION=${region}`,
  ];

  log('');
  log('=== Railway (A2P-Worker) に設定する env ===');
  for (const line of envLines) console.log(line);

  if (railwaySet) {
    log('');
    log('--railway-set が指定されたため railway CLI で反映します...');
    const setArgs = ['variables', '--service', 'A2P-Worker'];
    for (const line of envLines) setArgs.push('--set', line);
    const result = spawnSync('railway', setArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      log('railway CLI の実行に失敗しました。手動で上記 env を設定してください。');
      process.exit(result.status ?? 1);
    }
    log('Railway への設定が完了しました。worker の再起動が必要な場合があります。');
  } else {
    log('');
    log('上記を Railway ダッシュボード (A2P-Worker サービス > Variables) に手動で設定するか、');
    log('本スクリプトに --railway-set を付けて再実行してください(要 railway CLI ログイン済み)。');
  }
}

main().catch((err) => {
  console.error('[amazon-ads-oauth] エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
