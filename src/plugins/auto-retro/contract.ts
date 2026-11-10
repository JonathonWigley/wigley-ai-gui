import type { SlotKey } from '../../contracts/state';

// `rows` holds the row id of every open retro row, launched or restored, in the order the rows joined;
// `queued` counts the retros still waiting to run.
export interface AutoRetroState {
  rows: string[];
  queued: number;
}

// The retro rows main holds and the retros it has queued, written on each change.
export const autoRetroStateSlot: SlotKey<AutoRetroState, 'main', 'auto-retro'> =
  { id: 'auto-retro.state', process: 'main', kind: 'value' };
