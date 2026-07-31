/**
 * Amazon 2 段階認証コードの生成/取得 [F-041 Phase3・完全無人化の要]。
 *
 * 優先順位:
 *   1) TOTP シークレット (env `AMAZON_TOTP_SECRET` または `accounts.kdp_2fa_secret_enc` 復号値) が
 *      あれば otplib で 6 桁を **サーバー生成**する（完全無人）。
 *   2) 無ければ LINE 双方向認証リレー (`requestOtpViaLine`) にフォールバックし、運営者が
 *      LINE で 6 桁を返信する（半自動）。
 *
 * Amazon の認証アプリ(Authenticator)は標準 TOTP (SHA1, 6 桁, 30 秒)。otplib の既定と一致する。
 */
import { authenticator } from 'otplib';

import { createLogger } from '@a2p/contracts/logger';

import { requestOtpViaLine, type LineAuthRelayPrisma } from '../lib/line-auth-relay.js';

const log = createLogger('worker.kdp-submit.totp');

/** TOTP シークレット文字列 (base32) から現在の 6 桁コードを生成する。 */
export function generateTotp(secret: string): string {
  // 空白/ハイフン除去 (Amazon の表示は 4 桁区切りのことがある)。otplib は base32 を要求。
  const clean = secret.replace(/[\s-]/g, '');
  return authenticator.generate(clean);
}

/** OTP 供給元。port の再認証ループから呼ばれる。code | null を返す。 */
export interface OtpProvider {
  /** kind: 'totp'(サーバー生成) | 'line'(運営者返信待ち)。 */
  readonly kind: 'totp' | 'line';
  getCode(prompt: string): Promise<string | null>;
}

export interface BuildOtpProviderDeps {
  prisma: LineAuthRelayPrisma;
  /** 復号済み TOTP シークレット (accounts.kdp_2fa_secret_enc 由来)。無ければ env を見る。 */
  totpSecret?: string | null;
  /** LINE relay の purpose ラベル。 */
  purpose?: string;
}

/**
 * 環境に応じて OTP プロバイダを構築する。
 * TOTP シークレットがあれば無人生成、無ければ LINE リレー。
 */
export function buildOtpProvider(deps: BuildOtpProviderDeps): OtpProvider {
  const secret = (deps.totpSecret || process.env.AMAZON_TOTP_SECRET || '').trim();
  if (secret) {
    return {
      kind: 'totp',
      async getCode() {
        try {
          const code = generateTotp(secret);
          log.info('generated TOTP code server-side (unattended)');
          return code;
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, 'TOTP generation failed');
          return null;
        }
      },
    };
  }
  return {
    kind: 'line',
    async getCode(prompt: string) {
      return requestOtpViaLine(deps.prisma, {
        purpose: deps.purpose ?? 'kdp_submit_relogin',
        prompt,
      });
    },
  };
}
