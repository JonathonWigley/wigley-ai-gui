import type { PresentedRound, RoundEnd, FormBody } from './forms';
import type { Log } from './log';
import type { AppConfig } from './settings';

export const BRIDGE_CHANNELS = {
  config: 'bridge:config',
  log: 'bridge:log',
  pluginInvoke: 'plugin:invoke',
  pluginMessage: 'plugin:message',
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
  // Calls `method` on the main part of plugin `pluginId`; rejects with main's
  // own error text when the handler throws.
  invoke(pluginId: string, method: string, args: unknown[]): Promise<unknown>;
  // Calls `listener` with each `message` main sends plugin `pluginId`.
  onMessage(
    pluginId: string,
    message: string,
    listener: (data: unknown) => void,
  ): void;
  // Rounds already open, with their latest drafts, for a page that just loaded.
  openRounds(): Promise<PresentedRound[]>;
  onRoundShown(listener: (round: PresentedRound) => void): void;
  onRoundClosed(listener: (roundId: string) => void): void;
  // A notification click asked to show this round.
  onFocusRound(listener: (roundId: string) => void): void;
  // Resolves once main has written the draft, or at once for a round no longer
  // open; rejects with main's own error text when the write failed.
  saveDraft(roundId: string, body: FormBody): Promise<void>;
  finishRound(roundId: string, end: RoundEnd): void;
}
