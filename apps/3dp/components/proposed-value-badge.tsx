import type { ProposalState } from '@/lib/settings-groups-core';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/cn';

const STYLE: Record<ProposalState, string> = {
  proposed: 'border-accent text-accent',
  confirmed: 'border-border-warm text-muted',
  changed: 'border-accent bg-charcoal-04 text-accent',
};

/** 色だけで区別しない (UR-6): 3 状態は別々の文言を持つ。 */
export function ProposedValueBadge({ state, testId }: { state: ProposalState; testId?: string }) {
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full border px-2 py-0.5 text-caption', STYLE[state])}
      data-state={state}
      data-testid={testId ?? 'tdp-proposal-badge'}
    >
      {messages.settings.badge[state]}
    </span>
  );
}
