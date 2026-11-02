import type { Disposable } from '../../../contracts/disposable';
import type { PageChannel } from '../../../contracts/plugin';
import type { ChatChannel } from '../contract';
import type { SlashCommands } from './slash-commands';

export interface ClearCommandDeps {
  commands: SlashCommands;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
}

// Registers `/clear` and Claude's other names for it, `/reset` and `/new`:
// each clears the session's conversation and restarts its agent.
export function addClearCommands(deps: ClearCommandDeps): Disposable[] {
  const { commands, channel } = deps;
  return ['clear', 'reset', 'new'].map((name) =>
    commands.add({
      name,
      description: 'Clear the conversation and restart the agent',
      run: ({ sessionId }) => channel.invoke('clear', sessionId),
    }),
  );
}
