/**
 * ツール選択画面（プラットフォームのハブ / 認証必須）。
 * ここで選んだツールへ SSO で素通り遷移する。ツールは lib/tools.ts のレジストリ由来。
 * トップバー/メニューは (app)/layout.tsx のシェルが提供する。
 */
import { auth } from '@/auth';
import { getTools } from '@/lib/tools';
import { ToolCard } from '@/components/tool-card';

export default async function ToolSelectionPage() {
  const session = await auth();
  const username = session?.user?.username ?? session?.user?.name ?? '';
  const tools = getTools();
  const liveCount = tools.filter((t) => t.status === 'live' && Boolean(t.url)).length;

  return (
    <div className="mx-auto max-w-6xl">
      {/* ヒーロー */}
      <section className="fade-up max-w-2xl">
        <div className="glass mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-white/60">
          <span className="live-dot" />
          {liveCount} tools live
        </div>
        <h1 className="text-3xl font-bold leading-[1.12] tracking-tight text-white sm:text-[2.75rem]">
          “稼ぐ”を、
          <br className="hidden sm:block" />
          <span className="brand-gradient">AIで自動化</span>する。
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
          {username ? `${username} さん、おかえりなさい。` : ''}
          M2P は、AI エージェントがコンテンツの制作・出版・販促・収益化までを動かす
          収益化ツールを集めたプラットフォームです。使うツールを選んでください。
        </p>
      </section>

      {/* ツールグリッド */}
      <section
        aria-label="ツール一覧"
        className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {tools.map((tool, i) => (
          <ToolCard key={tool.id} tool={tool} index={i} />
        ))}
      </section>
    </div>
  );
}
