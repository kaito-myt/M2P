import { describe, it, expect, afterEach, vi } from 'vitest';

import { generateTotp, buildOtpProvider } from './totp.js';

describe('generateTotp', () => {
  it('base32 シークレットから 6 桁を生成する', () => {
    const code = generateTotp('JBSWY3DPEHPK3PXP');
    expect(code).toMatch(/^\d{6}$/);
  });
  it('空白/ハイフン区切りを除去して生成する', () => {
    const a = generateTotp('JBSW Y3DP EHPK 3PXP');
    const b = generateTotp('JBSWY3DPEHPK3PXP');
    expect(a).toBe(b);
  });
});

describe('buildOtpProvider', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    vi.restoreAllMocks();
  });

  it('TOTP シークセット(引数)があれば kind=totp で無人生成', async () => {
    const p = buildOtpProvider({ prisma: {} as never, totpSecret: 'JBSWY3DPEHPK3PXP' });
    expect(p.kind).toBe('totp');
    const code = await p.getCode('x');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('引数が無くても env AMAZON_TOTP_SECRET を使う', async () => {
    process.env.AMAZON_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
    const p = buildOtpProvider({ prisma: {} as never });
    expect(p.kind).toBe('totp');
  });

  it('TOTP 未設定なら kind=line (LINE リレーへフォールバック)', () => {
    delete process.env.AMAZON_TOTP_SECRET;
    const p = buildOtpProvider({ prisma: {} as never });
    expect(p.kind).toBe('line');
  });
});
