import Link from 'next/link';

import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { SETTINGS_TABS, type SettingsTab } from '@/lib/settings-tabs-core';

export function TabNav({ active }: { active: SettingsTab }) {
  return (
    <nav aria-label={messages.settings.tabsAriaLabel} className="flex flex-wrap gap-space-tight" data-testid="tdp-settings-tabs">
      {SETTINGS_TABS.map((tab) => (
        <Link
          key={tab}
          href={tab === 'safety' ? '/settings' : `/settings?tab=${tab}`}
          aria-current={tab === active ? 'page' : undefined}
          data-testid={`tdp-tab-${tab}`}
          className={cn(
            'rounded-full border px-4 py-1.5 text-button-sm',
            tab === active
              ? 'border-charcoal bg-charcoal text-cream-light'
              : 'border-border-warm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal',
          )}
        >
          {messages.settings.tabs[tab]}
        </Link>
      ))}
    </nav>
  );
}
