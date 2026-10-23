import type { Disposable } from '../../../contracts/disposable';
import type { AppSlashCommand } from '../contract';

// The app slash commands registered now. `add` throws for a name already
// registered, and its `dispose` removes the command. `match` reads a box's
// text: once trimmed, `/` then a registered name, then nothing or whitespace
// and the args; null for any other text. `names` lists the registered names
// in registration order.
export interface SlashCommands {
  add(command: AppSlashCommand): Disposable;
  match(text: string): { command: AppSlashCommand; args: string } | null;
  names(): string[];
}

// `/name`, then optionally whitespace and the args, over trimmed text.
const SLASH_COMMAND = /^\/(\S+)(?:\s+([\s\S]*))?$/;

export function createSlashCommands(): SlashCommands {
  const commands = new Map<string, AppSlashCommand>();
  return {
    add(command) {
      if (commands.has(command.name)) {
        throw new Error(
          `App slash command /${command.name} is already registered`,
        );
      }
      commands.set(command.name, command);
      return {
        dispose() {
          if (commands.get(command.name) === command) {
            commands.delete(command.name);
          }
        },
      };
    },
    match(text) {
      const parsed = SLASH_COMMAND.exec(text.trim());
      const command = parsed === null ? undefined : commands.get(parsed[1]);
      if (parsed === null || command === undefined) {
        return null;
      }
      return { command, args: parsed[2] ?? '' };
    },
    names: () => [...commands.keys()],
  };
}

// The `/` completion's words: the app's names first, then each agent name the
// app does not hold, since an app name wins over the agent's.
export function completionWords(
  appNames: readonly string[],
  agentNames: readonly string[],
): string[] {
  const app = new Set(appNames);
  return [...appNames, ...agentNames.filter((name) => !app.has(name))];
}
