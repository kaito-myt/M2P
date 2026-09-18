/**
 * 公開ストアフロント「栞 -SHIORI-」の共通クローム (ヘッダ / フッタ / ワードマーク /
 * セクション見出し)。/blog・/blog/[slug]・/shop の 3 ページで共有する。
 *
 * 管理画面 (apps/web/app/(app)/) のトークンには依存せず、当ブランド独自の
 * 温かみのあるエディトリアル配色を arbitrary value で定義する:
 *   paper #F5EFE1 / raised #FBF6EA / ink #221D18 / body #52493B / caption #8B7E68 /
 *   line #E4DAC6 / green #1E5B49 / terracotta #B4471E / dark #171310 / gold #D8A15E
 *
 * すべてサーバーコンポーネント (フックなし)。ホバー等の微アニメは CSS のみ。
 */
import Link from 'next/link';

export interface NavItem {
  label: string;
  href: string;
}

/** 内部リンクは Link、外部/メール/アンカーは素の <a> を使い分ける。 */
function Nav({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** 栞のワードマーク。栞(和セリフ) + SHIORI(小さくトラッキング)。 */
export function Wordmark({ tone = 'ink' }: { tone?: 'ink' | 'light' }) {
  const kanji = tone === 'light' ? 'text-[#F4ECDB]' : 'text-[#221D18]';
  const roman = tone === 'light' ? 'text-[#D8A15E]' : 'text-[#B4471E]';
  return (
    <Link href="/blog" className="flex items-center gap-2.5 no-underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/blog-mark.png" alt="栞 -SHIORI-" className="h-8 w-8 rounded-[3px] object-cover" />
      <span className="flex items-baseline gap-2">
        <span className={`font-serif text-[22px] font-semibold leading-none tracking-tight ${kanji}`}>栞</span>
        <span className={`text-[9px] font-semibold uppercase tracking-[0.42em] ${roman}`}>Shiori</span>
      </span>
    </Link>
  );
}

/**
 * 公開ページ共通ヘッダ。sticky・細いヘアライン境界。
 * nav はテキストリンク (擬似下線アニメ)、cta は角丸控えめの矩形リンク。
 * ワードマーク右にタグライン (何のサイトか) をヘアラインで区切って常時提示する。
 */
export function SiteHeader({
  nav,
  cta,
  tagline = '実用書・ビジネス書・名作を“要点”で紹介',
  width = 'max-w-6xl',
}: {
  nav?: NavItem[];
  cta?: NavItem;
  tagline?: string | null;
  width?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#E4DAC6] bg-[#F5EFE1]/92 backdrop-blur-sm">
      <div className={`mx-auto flex ${width} items-center justify-between gap-6 px-5 py-4 sm:px-6`}>
        <div className="flex min-w-0 items-center gap-3.5">
          <Wordmark />
          {tagline && (
            <span className="hidden items-center gap-3.5 lg:flex">
              <span className="h-4 w-px bg-[#D8CBB0]" />
              <span className="text-[11.5px] leading-tight tracking-wide text-[#7A6E58]">{tagline}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-6 sm:gap-8">
          {nav && nav.length > 0 && (
            <nav className="hidden items-center gap-7 text-[13px] tracking-wide text-[#57503F] sm:flex">
              {nav.map((n) => (
                <Nav
                  key={n.href + n.label}
                  href={n.href}
                  className="relative no-underline transition-colors hover:text-[#221D18] after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:bg-[#1E5B49] after:transition-all after:duration-300 hover:after:w-full"
                >
                  {n.label}
                </Nav>
              ))}
            </nav>
          )}
          {cta && (
            <Nav
              href={cta.href}
              className="rounded-[2px] border border-[#221D18] px-4 py-1.5 text-[12px] font-medium tracking-wide text-[#221D18] no-underline transition-colors hover:bg-[#221D18] hover:text-[#F5EFE1]"
            >
              {cta.label}
            </Nav>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * 誌面的なセクション見出し。左に和文セリフ見出し、右に Fraunces のイタリック英字ラベル、
 * 間をヘアラインで埋める (雑誌のセクション扉のリズム)。
 */
export function SectionHeading({ jp, label }: { jp: string; label: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <h2 className="shrink-0 font-serif text-[1.35rem] font-semibold tracking-tight text-[#221D18]">{jp}</h2>
      <span className="h-px flex-1 bg-[#D8CBB0]" />
      <span className="shrink-0 font-display text-[12px] italic tracking-wide text-[#8B7E68]">{label}</span>
    </div>
  );
}

/**
 * F-ANP-31 Phase4: 公開済み ANP (note) 記事への相互送客セクション。0件なら何も描画しない。
 * データ取得は呼出側 (`apps/web/lib/related-note-articles.ts`) が行い、ここでは表示のみ担う。
 */
export function RelatedNoteArticles({
  articles,
}: {
  articles: Array<{ id: string; title: string; note_url: string }>;
}) {
  if (articles.length === 0) return null;
  return (
    <section className="border-t border-[#E4DAC6] py-14 md:py-16">
      <SectionHeading jp="note でも読める" label="Related notes" />
      <ul className="mt-9 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {articles.map((a) => (
          <li key={a.id}>
            <a
              href={a.note_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full flex-col justify-between border border-[#E4DAC6] bg-[#FBF6EA] p-5 no-underline transition-colors hover:border-[#1E5B49]"
            >
              <div>
                <p className="font-display text-[11px] italic tracking-wide text-[#8B7E68]">note</p>
                <h3 className="mt-2 font-serif text-[1.05rem] font-semibold leading-snug tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49]">
                  {a.title}
                </h3>
              </div>
              <span className="mt-4 inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-[#B4471E]">
                note で読む <span aria-hidden>→</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * PseudoCover — 書影が無い記事/書籍のための「装丁風」擬似カバー。
 *
 * ランタイム画像生成は使わない。CSS + タイポグラフィのみで、布張り(cloth)の
 * 書籍装丁を模す: 単色の地 + 内側の細い罫 + 栞リボンのモチーフ + 書名(セリフ)。
 * 書名から決定的にパレット/リボン位置を選び、均一な反復を避ける。
 *
 * サイズ非依存: ルートに `container-type: inline-size` を敷き、フォント/余白を
 * `cqi` (コンテナ幅%) で指定するため、リード(大)〜2up〜TOC極小まで同一実装で成立する。
 * ------------------------------------------------------------------------- */

/** 布張り装丁の配色。すべて温かみのある単色地 (紫青グラデ/グロー不使用)。 */
const COVER_PALETTES = [
  { bg: '#1E5B49', ink: '#F2EAD9', rule: '#4E7C6B', accent: '#E2B463', sub: '#CFC3A6' }, // 深緑クロス
  { bg: '#7A2E1B', ink: '#F4E6D6', rule: '#A05841', accent: '#E8C49C', sub: '#D8B69E' }, // 朱鷺・オックスブラッド
  { bg: '#26313F', ink: '#ECE7D9', rule: '#48586B', accent: '#D3A65F', sub: '#B9B4A4' }, // 紺クロス
  { bg: '#6A4A28', ink: '#F1E7D3', rule: '#8D6C46', accent: '#DAB176', sub: '#CDBB9A' }, // 革・タン
  { bg: '#ECE1C9', ink: '#382C1C', rule: '#C7B58C', accent: '#B4471E', sub: '#7A6A4E' }, // 生成りペーパー
  { bg: '#3D4030', ink: '#ECE6D0', rule: '#5F6148', accent: '#CBA85E', sub: '#AEA88F' }, // オリーブ
] as const;

function coverSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 書名から表題(装丁の主役)と副題を切り出す。『』「」や区切りを手掛かりにする。 */
function splitTitle(title: string): { main: string; sub: string | null } {
  const q = title.match(/『([^』]+)』|「([^」]+)」/);
  if (q) {
    const name = q[1] ?? q[2] ?? title;
    const rest = title
      .replace(q[0], ' ')
      .replace(/[—–―\-|:：/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { main: name, sub: rest.length >= 2 ? rest : null };
  }
  const parts = title
    .split(/[—–―|：:]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const [first, ...more] = parts;
    return { main: first ?? title, sub: more.join(' · ') };
  }
  return { main: title, sub: null };
}

/**
 * 擬似カバー。`compact` は極小サムネ (TOC 等) 用で、書名を省き栞エンブレムのみ表示。
 * 親は aspect を決め、これは全面を埋める (実書影の <img> と差し替え可能)。
 */
export function PseudoCover({
  title,
  genre,
  compact = false,
  seedKey,
}: {
  title: string;
  genre?: string | null;
  compact?: boolean;
  seedKey?: string;
}) {
  const seed = coverSeed(seedKey ?? title);
  const pal = COVER_PALETTES[seed % COVER_PALETTES.length]!;
  const ribbonLeft = (seed >> 2) % 2 === 0;
  const ruleWide = (seed >> 3) % 2 === 0;
  const { main, sub } = splitTitle(title);

  if (compact) {
    return (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{ backgroundColor: pal.bg, containerType: 'inline-size' }}
      >
        <span
          className="absolute top-0 h-[40%] w-[16cqi] min-w-[8px]"
          style={{
            backgroundColor: pal.accent,
            left: ribbonLeft ? '22%' : '64%',
            clipPath: 'polygon(0 0,100% 0,100% 100%,50% 76%,0 100%)',
          }}
        />
        <span
          className="absolute inset-0 flex items-center justify-center font-serif text-[40cqi] leading-none"
          style={{ color: pal.ink }}
        >
          栞
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: pal.bg, containerType: 'inline-size' }}
    >
      {/* 内側のヘアライン罫 (装丁の枠) */}
      <span className="pointer-events-none absolute inset-[5.5cqi] border" style={{ borderColor: pal.rule }} aria-hidden />
      {/* 栞リボンのモチーフ (上端から下げ、下端を切り欠く) */}
      <span
        className="absolute top-0 h-[34%] w-[9cqi] min-w-[10px]"
        style={{
          backgroundColor: pal.accent,
          left: ribbonLeft ? '16%' : '75%',
          clipPath: 'polygon(0 0,100% 0,100% 100%,50% 80%,0 100%)',
        }}
        aria-hidden
      />
      <div className="relative flex h-full flex-col justify-center gap-[3.2cqi] px-[11cqi] pb-[16cqi] pt-[13cqi] text-center">
        <span
          className="mx-auto text-[3.6cqi] font-semibold uppercase tracking-[0.26em]"
          style={{ color: pal.accent }}
        >
          {genre ?? 'Book Review'}
        </span>
        <span className={`mx-auto h-px ${ruleWide ? 'w-[22cqi]' : 'w-[12cqi]'}`} style={{ backgroundColor: pal.rule }} />
        <h4
          className="line-clamp-5 font-serif text-[9cqi] font-semibold leading-[1.3] [text-wrap:balance]"
          style={{ color: pal.ink }}
        >
          {main}
        </h4>
        {sub && (
          <p className="mx-auto line-clamp-2 max-w-[86%] text-[3.9cqi] leading-[1.55]" style={{ color: pal.sub }}>
            {sub}
          </p>
        )}
      </div>
      <span
        className="absolute inset-x-0 bottom-[7cqi] text-center font-display text-[3.2cqi] italic tracking-wide"
        style={{ color: pal.sub }}
        aria-hidden
      >
        栞 — SHIORI
      </span>
    </div>
  );
}

/** 公開ページ共通フッタ (dark)。ブランド一言 + ナビ + コピーライト。 */
export function SiteFooter({ nav, width = 'max-w-6xl' }: { nav: NavItem[]; width?: string }) {
  return (
    <footer className="mt-auto w-full bg-[#171310] text-[#B9AE97]">
      <div className={`mx-auto ${width} px-5 py-12 sm:px-6`}>
        <div className="flex flex-col gap-6 border-b border-[#2C251E] pb-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <Wordmark tone="light" />
            <p className="mt-4 text-[13px] leading-[1.9] text-[#93897A]">
              実用書・ビジネス書・自己啓発の名作と、要点をまとめた電子書籍をお届けするブックジャーナル。
              「読む前に価値がわかる」レビューを、毎日そっと差し込みます。
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
            {nav.map((n) => (
              <Nav key={n.href + n.label} href={n.href} className="text-[#B9AE97] no-underline transition-colors hover:text-[#F4ECDB]">
                {n.label}
              </Nav>
            ))}
          </nav>
        </div>
        <p className="mt-6 text-[12px] tracking-wide text-[#6F665A]">© {new Date().getFullYear()} 栞 -SHIORI-　良書の要点を、毎日ひとつ。</p>
      </div>
    </footer>
  );
}
