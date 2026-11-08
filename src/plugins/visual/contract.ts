import type { CommandKey } from '../../contracts/commands';
import type { EventShape } from '../../contracts/plugin';

// Opens the full-size overlay on the one visual whose HTML source is the arg,
// as its expand control does.
export const visualExpandCommand: CommandKey<string, 'visual.expand'> = {
  id: 'visual.expand',
};

// `visualOpened`: the full-size overlay opened on visual `index` of `count`.
export interface VisualPageEvents extends EventShape {
  visualOpened: { count: number; index: number };
}

// The visual plugin's channel between its main and page parts, which carries
// nothing: main only registers the layouts and the session note.
export interface VisualChannel {
  invoke: Record<never, never>;
  messages: Record<never, never>;
}
