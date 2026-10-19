import { messages } from '@/lib/messages';
import { buildFieldViews } from '@/lib/settings-tabs-core';
import type { TdpSettings } from '@/lib/tdp-settings';

import { GroupForm } from './group-form';
import { TabIntro } from './tab-intro';

export function GatesTab({ settings, readOnly }: { settings: TdpSettings; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-space-loose">
      <TabIntro group="gates" settings={settings} readOnly={readOnly} />
      <section className="border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.settings.tabs.gates}</h2>
        <div className="mt-space-relaxed">
          <GroupForm group="gates" fields={buildFieldViews('gates', settings)} readOnly={readOnly} />
        </div>
      </section>
    </div>
  );
}
