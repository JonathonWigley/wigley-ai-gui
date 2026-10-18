import type { PresentedRound, RoundEnd, FormBody } from './forms';
import type { Log } from './log';
import type { AppConfig } from './settings';

export const BRIDGE_CHANNELS = {
  config: 'bridge:config',
  log: 'bridge:log',
  openRounds: 'forms:open-rounds',
  roundShown: 'forms:shown',
  roundClosed: 'forms:closed',
  focusRound: 'forms:focus',
  draft: 'forms:draft',
  finish: 'forms:finish',
} as const;

// What the preload exposes to the renderer as `window.wigley`.
export interface Bridge {
  config(): Promise<AppConfig>;
  onLog(listener: Log): void;
  // Rounds already open, with their latest drafts, for a page that just loaded.
  openRounds(): Promise<PresentedRound[]>;
  onRoundShown(listener: (round: PresentedRound) => void): void;
  onRoundClosed(listener: (roundId: string) => void): void;
  // A notification click asked to show this round.
  onFocusRound(listener: (roundId: string) => void): void;
  saveDraft(roundId: string, body: FormBody): void;
  finishRound(roundId: string, end: RoundEnd): void;
}
