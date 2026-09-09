---
name: reference_openai_fallback
description: Anthropic停止時の緊急フォールバック手順(仕上げ工程をopenai/gpt-5へ一時切替)と実測結果 — 2026-09-01にカード拒否で実施→同日復旧・完全復元済み
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-01T09:51:38.915Z
---

**実施済み・復元済み (2026-09-01)**: Anthropic クレジット購入がカード拒否→ユーザー承認で仕上げ工程を gpt-5 へ一時切替→
同日クレジット復旧→ `scripts/.stage/revert-anthropic.cjs` で **完全復元**(active は元の anthropic 行、openai 行は archived)。
現在は一時切替なし。

**フォールバック手順 (再利用可)** — `scripts/.stage/reroute-openai.cjs`:
1. OpenAI probe (gpt-5 1 call) → `model_assignments` の anthropic 行を archived、同 role+genre で `openai/gpt-5` 行を
   `created_by='temp-openai-reroute-<date>'` で追加。元行は `scripts/.stage/ma-backup.json` に保存。
2. OpenAI 化した工程のジョブだけ解放/再投入(TASKS ホワイトリスト)。文体を決める writer/marketer/outline_review は
   Anthropic のまま `run_at=+6h` で保留。
3. 復元 = `revert-anthropic.cjs`(Anthropic probe → backup の id を active に戻す → 全保留解放 → exhausted 再投入)。

**実測 (gpt-5 vs Claude)**:
- editor: **¥16/call**(Opus 5 は ¥68) — 品質差は整える工程では小さい。
- judge: **¥44/冊**(Sonnet 5 は ¥280、25万 token 長編)。ただし**採点が甘い**(同じ本で Sonnet 65→gpt-5 84、54→86)。
  gpt-5 判定で合格した本は改稿ループに入らない。継続性欠陥は判定モデルに頼らず**本文の機械走査**で確認する
  (`scripts/.stage/namecheck.cjs` / `contcheck.cjs`: 章ごとの人物名頻度・性別手がかり・号室・年齢)。
- **readings は gpt-5 で失敗**(`No object generated` — 構造化出力が空)。readings は Anthropic のまま保留が正解。
- seo_optimizer / blog_seo / thumbnail_image は元々 openai で問題なし。

**教訓**: Anthropic 停止時は「全部待つ」か「全部 OpenAI」の二択ではなく、**文体工程は温存・仕上げ工程だけ切替**が
最小損失。復旧後は必ず元に戻す(Opus 5 編集は高コストなので、恒久的にコストを下げたいなら editor を Sonnet 5 に
寄せる方が筋が良い — ユーザー判断事項)。

関連: [[reference_worker_db_outage]] [[reference_model_assignment_routing]] [[reference_pipeline_stuck_books]]
