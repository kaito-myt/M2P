/** Booth入稿タブ (F-096)。本体は ChannelChecklistPage。 */
import type { Metadata } from 'next';

import { messages } from '@/lib/messages';
import { ChannelChecklistPage } from '@/components/channels/channel-checklist-page';

export const metadata: Metadata = {
  title: `${messages.channelChecklist.booth.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

export default function BoothPage() {
  return <ChannelChecklistPage channel="booth" />;
}
