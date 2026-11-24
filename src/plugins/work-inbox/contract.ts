// The Inbox view's place: what a page reload puts back.

import type { SlotKey } from '../../contracts/state';
import type { WorkSection } from '../work/contract';

// A work section, or `all`, which lists every item in every state.
export type InboxSectionId = WorkSection | 'all';

// Where the user was in Inbox mode. `section`: the section shown, or the one shown before the filter while
// `ticketFilter` is set; `ticketFilter`: the ticket key the list is filtered to, null for none; `cursorId`: the cursor
// card's item id; `drafts`: the user's edits of each item's draft, by item id, kept while the item is in `work.state`;
// `paneOpen`: whether the detail pane is open.
export interface WorkInboxPlace {
  section: InboxSectionId;
  ticketFilter: string | null;
  cursorId: string | null;
  drafts: Record<string, string>;
  paneOpen: boolean;
}

export const workInboxPlaceSlot: SlotKey<WorkInboxPlace, 'page', 'work-inbox'> =
  {
    id: 'work-inbox.place',
    process: 'page',
    kind: 'value',
  };
