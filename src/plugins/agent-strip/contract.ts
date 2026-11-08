import type { CommandKey } from '../../contracts/commands';

// Opens or closes the box `key` in session `sessionId`'s strip and scrolls it
// into view, as a click on the box does.
export const agentStripToggleBoxAtCommand: CommandKey<
  { sessionId: string; key: string },
  'agent-strip.toggleBoxAt'
> = { id: 'agent-strip.toggleBoxAt' };
