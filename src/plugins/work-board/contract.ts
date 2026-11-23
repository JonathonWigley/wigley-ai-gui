// The Board view's place: what a page reload puts back.

import type { SlotKey } from '../../contracts/state';

// Where the user was in Board mode. `cursorCardId`: the cursor card's id (a Jira key, or a local task's
// `local-<uuid>`), null on an empty board.
export interface WorkBoardPlace {
  cursorCardId: string | null;
}

export const workBoardPlaceSlot: SlotKey<WorkBoardPlace, 'page', 'work-board'> =
  {
    id: 'work-board.place',
    process: 'page',
    kind: 'value',
  };
