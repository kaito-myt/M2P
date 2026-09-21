'use server';

/**
 * AI 指示への画像添付 (F-ANP-06, docs/11-anp-design.md §3.1) — クリップボード貼り付け / ドロップ /
 * ファイル選択で受け取った画像を R2 `anp/uploads/<id>.<ext>` に保存し、プレビュー用の署名 URL を返す。
 * 保存したキーは各機能 (プロフィール素材の生成、AI 相談) のペイロードに載せ、worker が LLM の
 * ビジョン入力として渡す。
 */
import { randomUUID } from 'node:crypto';

import { getSignedDownloadUrl, uploadBuffer } from '@a2p/storage/operations';
import { anpUpload } from '@a2p/storage/keys';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface UploadedImage {
  key: string;
  url: string;
  mime: string;
  size: number;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MIME_TO_EXT: Record<string, 'png' | 'jpg' | 'webp' | 'gif'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** プレビュー署名 URL の有効期限 (秒)。 */
const PREVIEW_TTL_SEC = 900;

export async function uploadInstructionImage(formData: FormData): Promise<ActionResult<UploadedImage>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const um = messages.uploads.errors;

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: um.noFile };
  const ext = MIME_TO_EXT[file.type];
  if (!ext) return { ok: false, error: um.unsupportedType };
  if (file.size <= 0) return { ok: false, error: um.noFile };
  if (file.size > MAX_BYTES) return { ok: false, error: um.tooLarge };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = randomUUID().replace(/-/g, '');
    const key = anpUpload(id, ext);
    await uploadBuffer(key, buffer, file.type === 'image/jpg' ? 'image/jpeg' : file.type);
    const url = await getSignedDownloadUrl(key, PREVIEW_TTL_SEC);
    return { ok: true, data: { key, url, mime: file.type, size: file.size } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : um.uploadFailed };
  }
}

/** 既存キーのプレビュー URL を再発行する (ページ再読込後の表示用)。 */
export async function signUploadedImages(input: { keys: string[] }): Promise<ActionResult<Array<{ key: string; url: string | null }>>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const keys = Array.isArray(input?.keys) ? input.keys.filter((k): k is string => typeof k === 'string' && k.startsWith('anp/uploads/')).slice(0, 20) : [];
  const out = await Promise.all(
    keys.map(async (key) => {
      try {
        return { key, url: await getSignedDownloadUrl(key, PREVIEW_TTL_SEC) };
      } catch {
        return { key, url: null };
      }
    }),
  );
  return { ok: true, data: out };
}
