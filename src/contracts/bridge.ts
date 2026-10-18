import type { StopReason } from './agent';
import type { Log } from './log';
import type { AppConfig } from './settings';

export const BRIDGE_CHANNELS = {
  config: 'bridge:config',
  log: 'bridge:log',
  prompt: 'bridge:prompt',
} as const;

// What the preload exposes to the renderer as `window.wigley`.
export interface Bridge {
  config(): Promise<AppConfig>;
  onLog(listener: Log): void;
  promptAgent(text: string): Promise<StopReason>;
}
