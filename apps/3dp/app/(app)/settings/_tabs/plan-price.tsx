import { messages } from '@/lib/messages';
import { buildFieldViews } from '@/lib/settings-tabs-core';
import type { TdpSettings } from '@/lib/tdp-settings';

import { GroupForm } from './group-form';
import { TabIntro } from './tab-intro';

export function PlanPriceTab({ settings, readOnly }: { settings: TdpSettings; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-space-loose">
      <TabIntro group="plan_price" settings={settings} readOnly={readOnly} />
      <section className="border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{messages.settings.tabs.plan_price}</h2>
        <div className="mt-space-relaxed">
          <GroupForm group="plan_price" fields={buildFieldViews('plan_price', settings)} readOnly={readOnly} />
        </div>
      </section>
    </div>
  );
}
