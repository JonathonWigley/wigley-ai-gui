// The live-view plugin's slot.

import type { KeyedSlotKey } from '../../contracts/state';

// The Game View's part of a window, each value a fraction of the window's
// width or height, top-left origin.
export interface CaptureCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// What a session's Live section shows: a window's stream, cropped to its Game
// View or whole (`crop` null), or the line that Screen Recording is off.
// `windowSize` is the window's size in points when it was picked; `summary`
// names what streams.
export type LivePick =
  | {
      readonly kind: 'stream';
      readonly sourceId: string;
      readonly summary: string;
      readonly windowSize: { readonly width: number; readonly height: number };
      readonly crop: CaptureCrop | null;
    }
  | { readonly kind: 'blocked' };

// Each session's Live pick, by session id, from its agent's last
// `show_live_view` or the app's playtest watch, until `hide_live_view`, an
// `editor_stop` for the project of a pick the app opened, or the session's
// end; no key means the section is hidden.
export const livePicksSlot: KeyedSlotKey<LivePick, 'main', 'live-view'> = {
  id: 'live-view.picks',
  process: 'main',
  kind: 'keyed',
};
