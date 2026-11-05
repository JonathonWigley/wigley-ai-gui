import type {
  CommandId,
  CommandKey,
  CommandRunContext,
} from '../contracts/commands';
import type { Disposable } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type { CommandInfo, ProcessName } from '../contracts/plugin';
import { checkCommandArg, commandTarget } from './command-args';
import type { CommandRegistry } from './command-registry';

// `infoOf` reads the freshest catalog the process has. `remote` sends a run to the
// other process and resolves once it settles.
export interface CommandRouterDeps<Context extends { arg: unknown }> {
  process: ProcessName;
  registry: CommandRegistry<Context>;
  infoOf(id: CommandId): CommandInfo | undefined;
  remote(id: CommandId, arg: unknown): Promise<void>;
}

// The one path a run takes. `run` throws at the call for an unknown id, for a bad
// argument and for this process's command with no handler; otherwise it starts the
// handler here before it returns, or hands the run to `remote`, and resolves once
// the run settles. `intercept` wraps a run here, and throws for a command the
// catalog knows as the other process's; an id it does not know yet is accepted. A
// wrap has the limit `CommandRegistry.intercept` states.
export interface CommandRouter<Context extends { arg: unknown }> {
  run(
    command: CommandId | CommandKey<unknown>,
    arg: unknown,
    extras?: Omit<Context, 'arg'>,
  ): Promise<void>;
  intercept(
    id: CommandId,
    wrap: (
      next: () => Promise<void>,
      context: CommandRunContext,
    ) => void | Promise<void>,
    owner: string,
  ): Disposable;
}

// What a key path needs of the core's commands.
export interface KeyCommands<Context extends { arg: unknown }> {
  run: CommandRouter<Context>['run'];
  has(id: CommandId): boolean;
  requireRegistered(ids: Iterable<CommandId>): void;
}

// The key press firing a bind: its keys, and the log source its lines go under.
// `logsRun` also logs each run it starts.
export interface FiredKeys {
  keys: string;
  source: string;
  log: Log;
  logsRun?: boolean;
}

// Runs `bind` and returns true. A runtime command disposed since the last keymap
// has no handler until the next, so its key logs that, runs nothing and returns
// false.
export function runBound<Context extends { arg: unknown }>(
  commands: Pick<KeyCommands<Context>, 'run' | 'has'>,
  bind: { command: CommandId; arg?: unknown },
  fired: FiredKeys,
  extras: Omit<Context, 'arg'>,
): boolean {
  const { keys, source, log } = fired;
  if (!commands.has(bind.command)) {
    log(source, `${keys} names no command ${bind.command}`);
    return false;
  }
  if (fired.logsRun === true) {
    log(source, `${keys} ran ${commandTarget(bind.command, bind.arg)}`);
  }
  void commands.run(bind.command, bind.arg, extras);
  return true;
}

export function createCommandRouter<Context extends { arg: unknown }>(
  deps: CommandRouterDeps<Context>,
): CommandRouter<Context> {
  return {
    run(command, arg, extras) {
      const id = typeof command === 'string' ? command : command.id;
      const info = deps.infoOf(id);
      if (info === undefined) {
        throw new Error(`No command is registered as "${id}"`);
      }
      const problem = checkCommandArg(id, info.arg, arg);
      if (problem !== null) {
        throw new Error(problem);
      }
      if (info.runsIn !== deps.process) {
        return deps.remote(id, arg);
      }
      return deps.registry.run(id, { ...extras, arg } as Context);
    },
    intercept(id, wrap, owner) {
      const info = deps.infoOf(id);
      if (info !== undefined && info.runsIn !== deps.process) {
        throw new Error(`${id} runs in ${info.runsIn}; intercept it there`);
      }
      return deps.registry.intercept(id, wrap, owner);
    },
  };
}
