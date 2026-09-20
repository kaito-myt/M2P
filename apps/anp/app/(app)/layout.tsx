/**
 * `(app)` route group layout — 認証必須エリア共通の Header + Sidebar + Main Content シェル。
 * A2P (`apps/web/app/(app)/layout.tsx`) と同構造 (docs/11-anp-design.md §5.1)。
 * `(auth)/login` はこのグループの外にあるため本レイアウトを通らない。
 * 認証チェックは middleware.ts が担当 (auth.config.ts callbacks.authorized)。
 */
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-cream text-foreground">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-space-loose">{children}</main>
      </div>
    </div>
  );
}
