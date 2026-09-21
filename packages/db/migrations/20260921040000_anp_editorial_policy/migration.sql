-- docs/11-anp-design.md §3.1 F-ANP-07: note アカウントの記事の方針・トンマナ (プロンプト注入用)。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "editorial_policy" TEXT;
