import type { AgentCommand } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { AppSlashCommand, CompletionCommand } from '../contract';

// The app slash commands registered now. `add` throws for a name already
// registered, and its `dispose` removes the command. `match` reads a box's
// text: once trimmed, `/` then a registered name, then nothing or whitespace
// and the args; null for any other text. `list` holds the registered commands
// in registration order.
export interface SlashCommands {
  add(command: AppSlashCommand): Disposable;
  match(text: string): { command: AppSlashCommand; args: string } | null;
  list(): AppSlashCommand[];
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
    list: () => [...commands.values()],
  };
}

// The `/` completion's commands: the app's first, then each agent command the
// app holds no name of, without an alias that equals an app name, since an app
// name wins over the agent's.
export function completionCommands(
  app: readonly AppSlashCommand[],
  agent: readonly AgentCommand[],
): CompletionCommand[] {
  const appNames = new Set(app.map((command) => command.name));
  return [
    ...app.map(({ name, description }): CompletionCommand => ({
      name,
      description,
      argumentHint: '',
      aliases: [],
      source: 'app',
    })),
    ...agent
      .filter((command) => !appNames.has(command.name))
      .map((command): CompletionCommand => ({
        ...command,
        aliases: command.aliases.filter((alias) => !appNames.has(alias)),
        source: 'agent',
      })),
  ];
}
