import { messages } from '@/lib/messages';
import { buildFieldViews } from '@/lib/settings-tabs-core';
import type { TdpSettings } from '@/lib/tdp-settings';

import { GroupForm } from './group-form';
import { TabIntro } from './tab-intro';

export function GenerationTab({ settings, readOnly }: { settings: TdpSettings; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-space-loose">
      <TabIntro group="generation" settings={settings} readOnly={readOnly} />
      <section className="border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.settings.tabs.generation}</h2>
        <div className="mt-space-relaxed">
          <GroupForm group="generation" fields={buildFieldViews('generation', settings)} readOnly={readOnly} />
        </div>
      </section>
    </div>
  );
}
