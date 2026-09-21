---
name: reference-bash-backslash-collapse
description: "Bash ツールに渡したコマンド文字列内の `\\\\` は `\\` に潰れて届く (2026-09-21 実測)。python heredoc パッチで `'\\\\n'` を書くと実ファイルに改行が入り TS が壊れる"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 80ff9c8a-2155-4f98-a6c0-5becb68318b9
  modified: 2026-09-21T07:50:04.081Z
---

**現象**: Bash ツールの command 内で `\\n` と書いても、シェル/Python には `\n` として届く（quoted heredoc でも同じ）。python の `'''...'''` に `'\\n'` と書いて TS ファイルへ書き込むと、`join('\n')` のはずが実改行になり `Unterminated string literal` で typecheck が落ちる（2026-09-21 に `seed-anp.ts` と `strategist.ts` で発生。前者は並走エージェントが修正）。

**How to apply**: Bash 経由の python パッチでバックスラッシュを書き込みたいときは `chr(92)` を連結する（例 `bs=chr(92); "join('"+bs+"n')"`）か、Write/Edit ツールでファイルを書く。既存行のマッチ（old 文字列）も同じ理由でずれるので、バックスラッシュを含む行は Edit ツールで扱う。
