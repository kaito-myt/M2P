'use client';

/**
 * ImageAttachTextarea — AI への指示文に画像を添付できるテキストエリア (F-ANP-06)。
 * ChatGPT と同じ操作感: クリップボードから Ctrl+V で貼り付け / ドラッグ&ドロップ / 📎 でファイル選択。
 * 画像は貼った瞬間に Server Action `uploadInstructionImage` で R2 に保存し、サムネイル表示。
 * 親には `attachments` (R2 キー + プレビュー URL) を渡す。
 */
import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';

import { uploadInstructionImage, type UploadedImage } from '@/app/actions/uploads';
import { messages } from '@/lib/messages';

export interface ImageAttachment {
  key: string;
  url: string;
  mime: string;
}

export interface ImageAttachTextareaProps {
  value: string;
  onChange: (value: string) => void;
  attachments: ImageAttachment[];
  onAttachmentsChange: (next: ImageAttachment[]) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  maxImages?: number;
  disabled?: boolean;
  /** ⌘/Ctrl+Enter で呼ぶ (送信ショートカット)。 */
  onSubmitShortcut?: () => void;
  className?: string;
  'data-testid'?: string;
}

const um = messages.uploads;

export function ImageAttachTextarea(props: ImageAttachTextareaProps) {
  const maxImages = props.maxImages ?? 4;
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      const room = maxImages - props.attachments.length;
      if (room <= 0) {
        setError(um.errors.tooMany(maxImages));
        return;
      }
      setError(null);
      const batch = images.slice(0, room);
      setUploading((n) => n + batch.length);
      const added: ImageAttachment[] = [];
      for (const file of batch) {
        const fd = new FormData();
        fd.append('file', file, file.name || 'pasted.png');
        const res = await uploadInstructionImage(fd);
        if (res.ok) {
          const u: UploadedImage = res.data;
          added.push({ key: u.key, url: u.url, mime: u.mime });
        } else {
          setError(res.error);
        }
        setUploading((n) => n - 1);
      }
      if (added.length > 0) props.onAttachmentsChange([...props.attachments, ...added]);
    },
    [maxImages, props],
  );

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (props.onSubmitShortcut && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      props.onSubmitShortcut();
    }
  };

  const remove = (key: string) => props.onAttachmentsChange(props.attachments.filter((a) => a.key !== key));

  return (
    <div
      className={`rounded-card border bg-white ${dragging ? 'border-charcoal ring-2 ring-charcoal/20' : 'border-border-warm'} ${props.className ?? ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      data-testid={props['data-testid']}
    >
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder}
        rows={props.rows ?? 2}
        maxLength={props.maxLength}
        disabled={props.disabled}
        className="w-full resize-y rounded-card bg-transparent px-3 py-2 text-body text-charcoal focus:outline-none disabled:opacity-60"
      />
      {(props.attachments.length > 0 || uploading > 0) && (
        <ul className="flex flex-wrap gap-2 px-3 pb-2">
          {props.attachments.map((a) => (
            <li key={a.key} className="relative h-16 w-16 overflow-hidden rounded-card border border-border-warm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(a.key)}
                aria-label={um.remove}
                className="absolute right-0.5 top-0.5 rounded-full bg-charcoal/80 p-0.5 text-white"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <li key={`up-${i}`} className="flex h-16 w-16 items-center justify-center rounded-card border border-border-warm bg-cream-light">
              <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border-warm px-2 py-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={props.disabled || props.attachments.length >= maxImages}
          className="flex items-center gap-1 rounded-card px-2 py-1 text-caption text-charcoal-82 hover:bg-charcoal-04 disabled:opacity-50"
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          {um.attach}
        </button>
        <span className="text-caption text-muted">
          {um.hint(props.attachments.length, maxImages)}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2 text-caption text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
