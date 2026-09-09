/**
 * [F-086] KDPセッション切れ LINE 通知のクールダウンゲート。
 *
 * sales.fetch / kdp.publish.status.sync がセッション切れを検知するたびに通知すると
 * (再ログイン失敗が続くと 6h/リトライ毎に)「セッション切れを検知…」が連投され鬱陶しい。
 * app_settings.kdp_session_alert_at を基準に、既定24h に1回だけ通知を通す。
 *
 * 判定失敗(DB不通/テスト)時は true(通知する)に倒す — 通知漏れより連投抑止を優先しつつ安全側。
 */
import { prisma as defaultPrisma } from '@a2p/db';

const DEFAULT_COOLDOWN_H = 24;

export interface KdpSessionAlertGatePrisma {
  appSettings: {
    findUnique: (args: { where: { id: string }; select: { kdp_session_alert_at: true } }) => Promise<{ kdp_session_alert_at: Date | null } | null>;
    update: (args: { where: { id: string }; data: { kdp_session_alert_at: Date } }) => Promise<unknown>;
  };
}

/**
 * 通知して良ければ true を返し、同時に基準時刻を now で更新する（次の通知を cooldown だけ抑止）。
 * cooldown 内なら false（＝連投抑止）。
 */
export async function kdpSessionAlertGate(
  now: Date = new Date(),
  cooldownH: number = DEFAULT_COOLDOWN_H,
  prisma: KdpSessionAlertGatePrisma = defaultPrisma as unknown as KdpSessionAlertGatePrisma,
): Promise<boolean> {
  try {
    const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { kdp_session_alert_at: true } });
    const last = s?.kdp_session_alert_at ? new Date(s.kdp_session_alert_at) : null;
    if (last && now.getTime() - last.getTime() < cooldownH * 3600_000) {
      return false; // クールダウン中 — 連投しない
    }
    await prisma.appSettings.update({ where: { id: 'singleton' }, data: { kdp_session_alert_at: now } });
    return true;
  } catch {
    return true; // 判定不能時は通知を通す(安全側)
  }
}
