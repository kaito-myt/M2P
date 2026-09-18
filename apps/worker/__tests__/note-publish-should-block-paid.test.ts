import { describe, expect, it } from 'vitest';

import {
  buildNotePublicUrl,
  shouldBlockPaidPublish,
} from '../src/tasks/note-publish/playwright-note-publish-port.js';

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

describe('buildNotePublicUrl (2026-09-18: note 公開API から公開URLを組み立てる)', () => {
  it('note.com/<urlname>/n/<noteId> 形式を組み立てる', () => {
    expect(buildNotePublicUrl('ai_fukugyo_lab', 'nc3e4203790a3')).toBe(
      'https://note.com/ai_fukugyo_lab/n/nc3e4203790a3',
    );
  });
});
