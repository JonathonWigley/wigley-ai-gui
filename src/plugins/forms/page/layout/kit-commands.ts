import type { CommandId } from '../../../../contracts/commands';

// The commands a kit's `command` reaches: whether a plugin registers an id,
// and running it.
export interface KitCommands {
  exists(id: CommandId): boolean;
  run(id: CommandId): void;
}

// A runner for the command `qualifiedId`, which runs it on each call and
// never on creation. Throws `no command <id>` at once for an id no plugin
// registers, so a card or pane asking for one fails while it builds.
export function commandRunner(
  qualifiedId: CommandId,
  commands: KitCommands,
): () => void {
  if (!commands.exists(qualifiedId)) {
    throw new Error(`no command ${qualifiedId}`);
  }
  return () => commands.run(qualifiedId);
}
