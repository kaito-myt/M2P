-- AlterTable: blog_posts に SEO メタディスクリプション列を追加 (blog_seo エージェント用)
ALTER TABLE "blog_posts" ADD COLUMN "meta_description" TEXT;
