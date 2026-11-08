// The context-sources plugin's slot.

import type { ContextBreakdownAgentEvent } from '../../contracts/agent';
import type { KeyedSlotKey } from '../../contracts/state';

// Each session's last main-agent `contextBreakdown` event, by session id, until the session ends.
export const contextBreakdownsSlot: KeyedSlotKey<
  ContextBreakdownAgentEvent,
  'main',
  'context-sources'
> = {
  id: 'context-sources.breakdowns',
  process: 'main',
  kind: 'keyed',
};
