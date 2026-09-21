/**
 * @a2p/credentials — サービス連携 (R2 / LINE / Amazon Ads) の資格情報仕様 (docs/10-platform-portal.md §10.4b)。
 *
 * 運営者要望 (2026-09-21)「R2 の API 情報も M2P で管理できるようにしましょうか。モデル管理じゃなくて API 管理として、
 * API 関連は全部そこで管理できるようにしましょう」への対応。LLM プロバイダの単一キー (`@a2p/agents/lib/get-api-key`)
 * と違い、これらは複数項目 (account id / access key / bucket …) を一組で扱うため、
 *   - `api_credentials.provider` = 'r2' | 'line' | 'amazon_ads'
 *   - `api_credentials.key_enc`  = AES-256-GCM (API_CRED_KEY) で暗号化した項目 JSON
 *   - `api_credentials.key_mask` = 一覧表示用の要約 (秘密項目はマスク)
 * として同じテーブルに保存する。このファイルは DB 非依存の仕様/純関数のみ (ポータル UI・各リゾルバ・テストが共用)。
 */
import { z } from 'zod';

export const SERVICE_PROVIDERS = ['r2', 'line', 'amazon_ads'] as const;
export type ServiceProvider = (typeof SERVICE_PROVIDERS)[number];
export const serviceProviderSchema = z.enum(SERVICE_PROVIDERS);

export interface ServiceFieldSpec {
  /** JSON 内のキー。 */
  key: string;
  /** フォールバック元の環境変数名。 */
  env: string;
  label: string;
  /** true なら UI では伏せ字入力・マスク表示。 */
  secret: boolean;
  required: boolean;
  /** 入力ヒント。 */
  hint?: string;
  /** 選択式の項目 (例: region)。 */
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface ServiceProviderMeta {
  id: ServiceProvider;
  label: string;
  description: string;
  consoleUrl: string;
  usedFor: string;
  fields: ReadonlyArray<ServiceFieldSpec>;
}

export const SERVICE_PROVIDER_META: Record<ServiceProvider, ServiceProviderMeta> = {
  r2: {
    id: 'r2',
    label: 'Cloudflare R2 (オブジェクトストレージ)',
    description: '原稿・表紙・アイコン・添付画像など全ファイルの保存先。',
    consoleUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
    usedFor: 'A2P 書籍成果物 / ANP 画像・添付 / DB バックアップ',
    fields: [
      { key: 'account_id', env: 'R2_ACCOUNT_ID', label: 'Account ID', secret: false, required: true, hint: '32 桁の hex' },
      { key: 'access_key_id', env: 'R2_ACCESS_KEY_ID', label: 'Access Key ID', secret: false, required: true },
      { key: 'secret_access_key', env: 'R2_SECRET_ACCESS_KEY', label: 'Secret Access Key', secret: true, required: true },
      { key: 'bucket', env: 'R2_BUCKET_NAME', label: 'Bucket 名', secret: false, required: true, hint: '例: a2p-artifacts' },
    ],
  },
  line: {
    id: 'line',
    label: 'LINE Messaging API (認証リレー)',
    description: 'KDP の OTP 中継と note セッション失効通知を運営者の LINE に送る。',
    consoleUrl: 'https://developers.line.biz/console/',
    usedFor: 'KDP ログイン/OTP リレー (A2P) / note セッション失効通知 (ANP) / 出版ダイジェスト',
    fields: [
      { key: 'channel_access_token', env: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'チャネルアクセストークン (長期)', secret: true, required: true },
      { key: 'channel_secret', env: 'LINE_CHANNEL_SECRET', label: 'チャネルシークレット (Webhook 署名検証)', secret: true, required: false },
      { key: 'allowed_user_id', env: 'LINE_ALLOWED_USER_ID', label: '通知先ユーザー ID', secret: false, required: true, hint: 'U から始まる 33 文字' },
    ],
  },
  amazon_ads: {
    id: 'amazon_ads',
    label: 'Amazon Advertising API',
    description: '広告費・キャンペーン実績の日次自動計上 (F-090)。',
    consoleUrl: 'https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview',
    usedFor: 'A2P 広告費の純利益/ROAS 算入 (ads.spend.fetch)',
    fields: [
      { key: 'client_id', env: 'AMAZON_ADS_CLIENT_ID', label: 'LwA Client ID', secret: false, required: true, hint: 'amzn1.application-oa2-client.…' },
      { key: 'client_secret', env: 'AMAZON_ADS_CLIENT_SECRET', label: 'LwA Client Secret', secret: true, required: true },
      { key: 'refresh_token', env: 'AMAZON_ADS_REFRESH_TOKEN', label: 'Refresh Token', secret: true, required: true, hint: 'scripts/ads/amazon-ads-oauth.mjs で取得' },
      { key: 'profile_id', env: 'AMAZON_ADS_PROFILE_ID', label: 'Profile ID', secret: false, required: true },
      {
        key: 'region',
        env: 'AMAZON_ADS_REGION',
        label: 'Region',
        secret: false,
        required: true,
        options: [
          { value: 'fe', label: 'fe (日本・Far East)' },
          { value: 'na', label: 'na (北米)' },
          { value: 'eu', label: 'eu (欧州)' },
        ],
      },
    ],
  },
};

/** 各プロバイダの項目 JSON。空文字は「未設定」として扱う (保存時に落とす)。 */
export type ServiceFields = Record<string, string>;

const fieldValue = z.string().trim().max(4096);

/**
 * provider ごとの入力スキーマ (必須項目は 1 文字以上、選択式は候補内)。空文字は落として返す。
 * 更新時は `mergeServiceFields` で既存値を補ってから通す (秘密項目の空欄 = 変更なし)。
 */
export function serviceFieldsSchema(provider: ServiceProvider): z.ZodType<ServiceFields, z.ZodTypeDef, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of SERVICE_PROVIDER_META[provider].fields) {
    if (f.options) {
      const en = z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
      shape[f.key] = f.required ? en : en.or(z.literal('')).optional();
    } else {
      shape[f.key] = f.required ? fieldValue.min(1) : fieldValue.optional();
    }
  }
  return z.object(shape).transform((obj) => {
    const out: ServiceFields = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.length > 0) out[k] = v;
    return out;
  });
}

export const setServiceCredentialsInput = z.object({
  provider: serviceProviderSchema,
  fields: z.record(z.string(), z.string()),
});

/** 必須項目が全て揃っているか。 */
export function isServiceComplete(provider: ServiceProvider, fields: ServiceFields | null | undefined): boolean {
  if (!fields) return false;
  return SERVICE_PROVIDER_META[provider].fields.every((f) => !f.required || (fields[f.key] ?? '').length > 0);
}

/** env から項目 JSON を組み立てる。必須不足なら null。 */
export function serviceFieldsFromEnv(provider: ServiceProvider, env: Record<string, string | undefined> = process.env): ServiceFields | null {
  const out: ServiceFields = {};
  for (const f of SERVICE_PROVIDER_META[provider].fields) {
    const v = env[f.env];
    if (typeof v === 'string' && v.trim().length > 0) out[f.key] = v.trim();
  }
  return isServiceComplete(provider, out) ? out : null;
}

/** 秘密項目を `<先頭3>…<末尾4>` に伏せる (短い値は全て `*`)。 */
export function maskSecret(value: string): string {
  if (value.length <= 7) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

/** UI 表示用に秘密項目だけマスクした項目 JSON。 */
export function maskServiceFields(provider: ServiceProvider, fields: ServiceFields): ServiceFields {
  const out: ServiceFields = {};
  for (const f of SERVICE_PROVIDER_META[provider].fields) {
    const v = fields[f.key];
    if (typeof v !== 'string' || v.length === 0) continue;
    out[f.key] = f.secret ? maskSecret(v) : v;
  }
  return out;
}

/** `api_credentials.key_mask` に入れる 1 行要約 (例: `bucket=a2p-artifacts key=3f2…9a1c`)。 */
export function summarizeServiceFields(provider: ServiceProvider, fields: ServiceFields): string {
  const masked = maskServiceFields(provider, fields);
  switch (provider) {
    case 'r2':
      return `bucket=${masked.bucket ?? '?'} key=${masked.access_key_id ? maskSecret(masked.access_key_id) : '?'}`;
    case 'line':
      return `to=${masked.allowed_user_id ? maskSecret(masked.allowed_user_id) : '?'} token=${masked.channel_access_token ?? '?'}`;
    case 'amazon_ads':
      return `profile=${masked.profile_id ?? '?'} region=${masked.region ?? '?'} client=${masked.client_id ? maskSecret(masked.client_id) : '?'}`;
  }
}

/** 既存の保存値に新しい入力をマージする (空欄で送られた秘密項目は「変更なし」= 既存値を保持)。 */
export function mergeServiceFields(provider: ServiceProvider, existing: ServiceFields | null, incoming: ServiceFields): ServiceFields {
  const out: ServiceFields = {};
  for (const f of SERVICE_PROVIDER_META[provider].fields) {
    const next = incoming[f.key];
    const prev = existing?.[f.key];
    if (typeof next === 'string' && next.length > 0) out[f.key] = next;
    else if (f.secret && prev) out[f.key] = prev;
    else if (!f.secret && prev && next === undefined) out[f.key] = prev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 各サービスの型付き設定 (リゾルバの戻り値)
// ---------------------------------------------------------------------------

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface LineCredentials {
  channelAccessToken: string;
  channelSecret: string | null;
  allowedUserId: string;
}

export type AmazonAdsRegion = 'na' | 'eu' | 'fe';

export interface AmazonAdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: AmazonAdsRegion;
}

const req = (fields: ServiceFields, key: string): string => fields[key] ?? '';

export function toR2Credentials(fields: ServiceFields | null): R2Credentials | null {
  if (!fields || !isServiceComplete('r2', fields)) return null;
  return { accountId: req(fields, 'account_id'), accessKeyId: req(fields, 'access_key_id'), secretAccessKey: req(fields, 'secret_access_key'), bucket: req(fields, 'bucket') };
}

export function toLineCredentials(fields: ServiceFields | null): LineCredentials | null {
  if (!fields || !isServiceComplete('line', fields)) return null;
  return { channelAccessToken: req(fields, 'channel_access_token'), channelSecret: fields.channel_secret ?? null, allowedUserId: req(fields, 'allowed_user_id') };
}

export function toAmazonAdsCredentials(fields: ServiceFields | null): AmazonAdsCredentials | null {
  if (!fields || !isServiceComplete('amazon_ads', fields)) return null;
  const region = fields.region === 'na' || fields.region === 'eu' || fields.region === 'fe' ? fields.region : 'fe';
  return { clientId: req(fields, 'client_id'), clientSecret: req(fields, 'client_secret'), refreshToken: req(fields, 'refresh_token'), profileId: req(fields, 'profile_id'), region };
}
