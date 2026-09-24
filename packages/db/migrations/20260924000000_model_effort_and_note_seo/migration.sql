-- F-ANP-43: 役割ごとの推論量 (GPT-6 系の reasoning effort) を model_assignments に持たせる。
ALTER TABLE "model_assignments" ADD COLUMN IF NOT EXISTS "reasoning_effort" TEXT;

-- F-ANP-42 / F-ANP-41: note 内 SEO の成果物とアイキャッチ焼き込みコピー。
ALTER TABLE "note_articles" ADD COLUMN IF NOT EXISTS "seo_json" JSONB;
ALTER TABLE "note_articles" ADD COLUMN IF NOT EXISTS "eyecatch_copy" TEXT;
ALTER TABLE "note_articles" ADD COLUMN IF NOT EXISTS "eyecatch_sub" TEXT;
ALTER TABLE "note_articles" ADD COLUMN IF NOT EXISTS "eyecatch_alt" TEXT;
