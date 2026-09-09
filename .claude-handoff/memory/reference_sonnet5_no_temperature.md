---
name: reference_sonnet5_no_temperature
description: sonnet-5(claude-sonnet-5)にtemperatureを渡すとAPIが400で落ちる(deprecated); LLMCompleteArgsのtemperature省略
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-27T02:14:24.798Z
---

`claude-sonnet-5` は `temperature` パラメータが **deprecated** で、渡すと `anthropic request failed: \`temperature\` is deprecated for this model.` で 400 失敗する。

**How to apply:** 新しい LLM 呼び出しで sonnet-5(や以降のモデル)を使うとき `LLMCompleteArgs.temperature` は**渡さない**（省略）。`AISdkClient` は temperature を透過するため、agent 側で付けると落ちる。determinism が欲しくても temperature:0 は不可。

発覚: book_cover リゾルバ([[project_home_dashboard]]系の栞ブログ F-092)の書籍同定呼び出しで temperature:0 を付けて全件失敗 → 削除で解消。opus-4.8 系でも同様の可能性あり、モデル差し替え時は temperature を外して検証すること。関連: [[reference_model_assignment_routing]]。
