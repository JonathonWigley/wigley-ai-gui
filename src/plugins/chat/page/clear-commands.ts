import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageChannel } from '../../../contracts/plugin';
import type { KeyedSlotReader } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import type { AppSlashCommand, ChatChannel } from '../contract';
import type { SlashCommands } from './slash-commands';

export interface ClearCommandDeps {
  commands: SlashCommands;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  harnesses: KeyedSlotReader<AgentHarnessInfo>;
  log: PluginLog;
}

const CLEAR_NAME = 'clear';

// Registers `/clear` and each name a registered harness declares for it
// (`AgentHarnessInfo.clearAliases`): each clears the session's conversation
// and restarts its agent.
export function addClearCommands(deps: ClearCommandDeps): Disposable {
  const { commands, channel, harnesses, log } = deps;
  const clearCommand = (name: string): AppSlashCommand => ({
    name,
    description: 'Clear the conversation and restart the agent',
    run: ({ sessionId }) => channel.invoke('clear', sessionId),
  });
  const clear = commands.add(clearCommand(CLEAR_NAME));
  let aliasNames: readonly string[] = [];
  let aliases: Disposable[] = [];
  const addAlias = (name: string): Disposable[] => {
    if (commands.list().some((command) => command.name === name)) {
      log(`clear alias /${name} skipped: /${name} is already registered`);
      return [];
    }
    return [
      commands.addAlias(clearCommand(name), () =>
        log(
          `clear alias /${name} dropped: /${name} is registered by another command`,
        ),
      ),
    ];
  };
  const registerAliases = () => {
    const names = clearAliasesOf(harnesses.all());
    if (sameNames(names, aliasNames)) {
      return;
    }
    for (const alias of aliases) {
      alias.dispose();
    }
    aliasNames = names;
    aliases = names.flatMap(addAlias);
  };
  registerAliases();
  const listener = harnesses.on(registerAliases);
  return {
    dispose() {
      callEach<Disposable>([listener, ...aliases, clear], (each) =>
        each.dispose(),
      );
    },
  };
}

// Each harness's clear aliases in the slot's order, each name once, without
// the app's own `clear`.
function clearAliasesOf(
  harnesses: ReadonlyMap<string, AgentHarnessInfo>,
): string[] {
  const names = new Set<string>();
  for (const info of harnesses.values()) {
    for (const name of info.clearAliases) {
      if (name !== CLEAR_NAME) {
        names.add(name);
      }
    }
  }
  return [...names];
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, at) => name === b[at]);
}
