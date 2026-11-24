// The Board view's place: what a page reload puts back.

import type { SlotKey } from '../../contracts/state';

// Where the user was in Board mode. `cursorCardId`: the cursor card's id (a Jira key, or a local task's
// `local-<uuid>`), null on an empty board. `paneOpen`: whether the detail pane shows. `drafts`: the unsent comment or
// reply text of each card that has one, by card id.
export interface WorkBoardPlace {
  cursorCardId: string | null;
  paneOpen: boolean;
  drafts: Record<string, string>;
}

export const workBoardPlaceSlot: SlotKey<WorkBoardPlace, 'page', 'work-board'> =
  {
    id: 'work-board.place',
    process: 'page',
    kind: 'value',
  };
