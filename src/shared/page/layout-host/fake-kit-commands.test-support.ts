import type { CommandId } from '../../../contracts/commands';
import type { CommandDecl, PluginManifest } from '../../../contracts/plugin';
import type { KitCommands } from './base-kit';

// The declaration `manifest` holds for qualified command `id`; undefined for an
// id of another plugin or one it does not declare.
function declarationOf(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  id: CommandId,
): CommandDecl | undefined {
  const prefix = `${manifest.id}.`;
  const short = id.startsWith(prefix) ? id.slice(prefix.length) : '';
  const commands: Readonly<Record<string, CommandDecl>> = manifest.commands;
  return Object.hasOwn(commands, short) ? commands[short] : undefined;
}

// The kit commands an owner's part under test checks and runs: every command
// `manifest` declares, with the arg it declares, and each of `others` with
// none. Each run goes to `run`.
export function fakeKitCommandsOf(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  run: KitCommands['run'] = () => undefined,
  others: readonly CommandId[] = [],
): KitCommands {
  return {
    exists: (id) =>
      declarationOf(manifest, id) !== undefined || others.includes(id),
    argShape: (id) => declarationOf(manifest, id)?.arg,
    run,
  };
}
