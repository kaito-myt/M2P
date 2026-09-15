import { describe, expect, it } from 'vitest';

import { shouldBlockPaidPublish } from '../src/tasks/note-publish/playwright-note-publish-port.js';

describe('shouldBlockPaidPublish (code review #2: 価格/有料ライン UI 未実装のため有料記事の実公開を止める)', () => {
  it('有料 かつ 実公開(dry_run=false) ならブロックする', () => {
    expect(shouldBlockPaidPublish(true, false)).toBe(true);
  });

  it('有料 かつ dry_run=true ならブロックしない(下書き保存のみなので安全)', () => {
    expect(shouldBlockPaidPublish(true, true)).toBe(false);
  });

  it('無料記事は dry_run に関わらずブロックしない', () => {
    expect(shouldBlockPaidPublish(false, false)).toBe(false);
    expect(shouldBlockPaidPublish(false, true)).toBe(false);
  });
});
