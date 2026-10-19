import { messages } from '@/lib/messages';
import type { SettingsGroup } from '@/lib/settings-groups-core';
import { confirmedAt } from '@/lib/settings-tabs-core';
import type { TdpSettings } from '@/lib/tdp-settings';

import { ConfirmGroup } from './confirm-group';

/** 各タブ先頭の説明と「確認した」操作。 */
export function TabIntro({
  group,
  settings,
  readOnly,
}: {
  group: SettingsGroup;
  settings: TdpSettings;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-space-snug">
      <p className="max-w-2xl text-caption text-muted">{messages.settings.tabDescriptions[group]}</p>
      <ConfirmGroup group={group} confirmedAt={confirmedAt(group, settings)} disabled={readOnly} />
    </div>
  );
}
