import { BookOpen, FileText, LayoutGrid, ArrowUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PlatformTool } from '@/lib/tools';

const ICONS: Record<string, typeof BookOpen> = {
  BookOpen,
  FileText,
  LayoutGrid,
};

/** tool.accent は CSS 変数（例 var(--accent)）or 任意色。カード側で --accent として注入。 */
function resolveAccent(raw?: string): string {
  if (!raw) return '#34d399';
  // トークン変数はダークテーマでは映えないので、既知のトークンは明るい色に読み替える。
  if (raw.includes('var(')) return '#818cf8';
  return raw;
}

export function ToolCard({ tool, index = 0 }: { tool: PlatformTool; index?: number }) {
  const Icon = ICONS[tool.icon] ?? LayoutGrid;
  const isLive = tool.status === 'live' && Boolean(tool.url);
  const accent = resolveAccent(tool.accent);
  const style = { '--accent': accent, animationDelay: `${80 + index * 70}ms` } as CSSProperties;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        {tool.logo ? (
          <span
            className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/95"
            style={{ boxShadow: `0 8px 24px -12px ${accent}` }}
          >
            {/* next/image を避け、依存を増やさず public 配下のロゴをそのまま表示 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tool.logo} alt={`${tool.name} ロゴ`} className="h-full w-full object-contain p-2" />
          </span>
        ) : (
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
            style={{ background: `linear-gradient(140deg, ${accent}, ${accent}99)` }}
          >
            <Icon className="h-6 w-6" />
          </span>
        )}

        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70">
            <span className="live-dot" />
            LIVE
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/45">
            準備中
          </span>
        )}
      </div>

      <div className="mt-6 min-w-0 flex-1">
        <h2 className="text-xl font-semibold tracking-tight text-white">{tool.name}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-white/55">{tool.description}</p>
      </div>

      <div className="mt-6 flex items-center gap-1.5 text-[13px] font-medium">
        {isLive ? (
          <>
            <span style={{ color: accent }}>ツールを開く</span>
            <ArrowUpRight
              className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              style={{ color: accent }}
            />
          </>
        ) : (
          <span className="text-white/35">まもなく公開</span>
        )}
      </div>
    </>
  );

  const base =
    'tool-card glass fade-up group flex min-h-[13.5rem] flex-col rounded-[20px] p-6';

  if (!isLive) {
    return (
      <div
        className={`${base} cursor-not-allowed opacity-70`}
        style={style}
        aria-disabled="true"
        data-testid={`tool-${tool.id}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <a
      href={tool.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} is-live no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
      style={style}
      data-testid={`tool-${tool.id}`}
    >
      {inner}
    </a>
  );
}
