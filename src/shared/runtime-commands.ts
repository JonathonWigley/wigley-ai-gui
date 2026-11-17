import type {
  CommandHop,
  CommandId,
  CommandOutcome,
  CommandSessions,
} from '../contracts/commands';
import type { RuntimeCatalog } from '../contracts/core-state';
import type { Disposable } from '../contracts/disposable';
import type { KeyBind, RuntimeBind } from '../contracts/keymap';
import type {
  CommandDecl,
  CommandHandler,
  CommandInfo,
  PluginCommands,
  ProcessName,
} from '../contracts/plugin';
import type { SlotReader, SlotWriter } from '../contracts/state';
import { acceleratorProblem } from './accelerator';
import { checkCommandArg } from './command-args';
import { CommandRegistry } from './command-registry';
import {
  type CommandRouter,
  createCommandRouter,
  type KeyCommands,
} from './command-router';
import { expandBind, qualify, runtimeLayerClash } from './plugin-manifests';

// What a process holds before its parts add anything.
export const EMPTY_RUNTIME_CATALOG: RuntimeCatalog = {
  commands: [],
  binds: { binds: [], app: [], intercept: [] },
  started: false,
};

// `writer` is this process's catalog, `other` the other process's as this process
// mirrors it, and `served` the commands of the config served now. `remote` is as
// `CommandRouterDeps` says.
export interface RuntimeCommandsDeps<Context extends { arg: unknown }> {
  process: ProcessName;
  registry: CommandRegistry<Context>;
  writer: SlotWriter<RuntimeCatalog>;
  other: SlotReader<RuntimeCatalog>;
  served(): Readonly<Record<CommandId, CommandInfo>>;
  leader(): string;
  remote(
    id: CommandId,
    arg: unknown,
    hop: CommandHop,
  ): Promise<CommandOutcome>;
}

// One process's commands: the registry of its handlers, the router every run takes,
// and each plugin's view of them, which reads and writes the process's catalog slot.
// `infoOf` is the router's read of a command: this process's catalog, then the
// other's, then the served config.
export interface RuntimeCommands<Context extends { arg: unknown }> {
  readonly registry: CommandRegistry<Context>;
  readonly router: CommandRouter<Context>;
  infoOf(id: CommandId): CommandInfo | undefined;
  readonly keyCommands: KeyCommands<Context>;
  forPlugin(
    pluginId: string,
    track: <T extends Disposable>(handle: T) => T,
  ): {
    commands: PluginCommands;
    bind(bind: RuntimeBind): Disposable;
  };
}

function isPageBind(bind: RuntimeBind): bind is KeyBind {
  return !('kind' in bind);
}

export function createRuntimeCommands<Context extends { arg: unknown }>(
  deps: RuntimeCommandsDeps<Context>,
): RuntimeCommands<Context> {
  const { process, registry, writer, other } = deps;
  const own = () => writer.get() ?? EMPTY_RUNTIME_CATALOG;
  const theirs = () => other.get() ?? EMPTY_RUNTIME_CATALOG;
  const inCatalogs = (id: CommandId) =>
    own().commands.find((info) => info.id === id) ??
    theirs().commands.find((info) => info.id === id);
  const servedInfo = (id: CommandId) => {
    const served = deps.served();
    return Object.hasOwn(served, id) ? served[id] : undefined;
  };
  // A served runtime entry can be an old page's, so the catalogs go first.
  const infoOf = (id: CommandId) => inCatalogs(id) ?? servedInfo(id);
  const router = createCommandRouter<Context>({
    process,
    registry,
    infoOf,
    remote: deps.remote,
  });
  // A served runtime entry neither catalog holds is an old page's, which no
  // run reaches.
  const list = (): readonly CommandInfo[] => {
    const served = Object.values(deps.served()).filter(
      (info) => info.runtime !== true,
    );
    const byId = new Map<CommandId, CommandInfo>();
    for (const info of [...own().commands, ...theirs().commands, ...served]) {
      if (!byId.has(info.id)) {
        byId.set(info.id, info);
      }
    }
    return [...byId.keys()].sort().map((id) => byId.get(id));
  };
  // Every refusal and failure is a rejection, never a throw at the call.
  const runFor = async (
    id: CommandId,
    arg: unknown,
    sessions: CommandSessions,
  ): Promise<CommandOutcome> => {
    const info = infoOf(id);
    if (info === undefined) {
      throw new Error(`Unknown command ${id}`);
    }
    const argProblem = checkCommandArg(id, info.arg, arg);
    if (argProblem !== null) {
      throw new Error(argProblem);
    }
    if (info.runsIn === process && !registry.has(id)) {
      throw new Error(`${id} has no handler`);
    }
    if (sessions.targetSessionId !== undefined && info.targets !== true) {
      throw new Error(`${id} takes no session`);
    }
    return router.run(id, arg, sessions as Omit<Context, 'arg'>, {
      reportErrors: true,
    });
  };
  const update = (change: (catalog: RuntimeCatalog) => RuntimeCatalog) =>
    writer.set(change(own()));
  const registerCommand = (
    pluginId: string,
    short: string,
    decl: CommandDecl,
    handler: CommandHandler,
  ): Disposable => {
    const id = qualify(pluginId, short);
    if (decl.runsIn !== process) {
      throw new Error(`${id} runs in ${decl.runsIn}; register it there`);
    }
    const servedEntry = servedInfo(id);
    if (inCatalogs(id) !== undefined || (servedEntry && !servedEntry.runtime)) {
      throw new Error(`Command "${id}" is already registered`);
    }
    const handle = registry.register(
      id,
      handler as CommandHandler<Context>,
      pluginId,
    );
    const info: CommandInfo = { ...decl, id, plugin: pluginId, runtime: true };
    update((catalog) => ({
      ...catalog,
      commands: [...catalog.commands, info],
    }));
    return {
      dispose() {
        handle.dispose();
        if (own().commands.includes(info)) {
          update((catalog) => withoutCommand(catalog, info));
        }
      },
    };
  };
  const addBind = (bind: RuntimeBind): Disposable => {
    const entry = isPageBind(bind) ? bind : bind.bind;
    const info = infoOf(entry.command);
    if (info === undefined) {
      throw new Error(`No command is registered as "${entry.command}"`);
    }
    if (info.runsIn !== process) {
      throw new Error(`${entry.command} runs in ${info.runsIn}; bind it there`);
    }
    const argProblem = checkCommandArg(entry.command, info.arg, entry.arg);
    if (argProblem !== null) {
      throw new Error(argProblem);
    }
    const leader = deps.leader();
    if (isPageBind(bind)) {
      expandBind(bind, leader);
    } else if (bind.kind === 'app') {
      const problem = acceleratorProblem(bind.bind.accelerator);
      if (problem !== null) {
        throw new Error(`Bind of ${entry.command}: ${problem}`);
      }
    }
    const everyBind = withBindEntry(
      {
        binds: [...theirs().binds.binds, ...own().binds.binds],
        app: [...theirs().binds.app, ...own().binds.app],
        intercept: [...theirs().binds.intercept, ...own().binds.intercept],
      },
      bind,
    );
    const clash = runtimeLayerClash(everyBind, leader);
    if (clash !== null) {
      throw new Error(clash);
    }
    update((catalog) => ({
      ...catalog,
      binds: withBindEntry(catalog.binds, bind),
    }));
    return {
      dispose() {
        update((catalog) => ({
          ...catalog,
          binds: withoutBindEntry(catalog.binds, entry),
        }));
      },
    };
  };
  return {
    registry,
    router,
    infoOf,
    keyCommands: {
      run: router.run,
      has: (id) => registry.has(id),
      requireRegistered: (ids) => registry.requireRegistered(ids),
    },
    forPlugin(pluginId, track) {
      return {
        commands: {
          // A plugin's plain run resolves no outcome; `runFor` gives it.
          run: (command: CommandId | { id: string }, arg?: unknown) =>
            router.run(command, arg).then(() => undefined),
          runFor,
          list,
          register: (short, decl, handler) =>
            track(registerCommand(pluginId, short, decl, handler)),
          intercept: (id, wrap) => track(router.intercept(id, wrap, pluginId)),
          onDidRun: (listener) => track(registry.onDidRun(listener, pluginId)),
        },
        bind: (bind) => track(addBind(bind)),
      };
    },
  };
}

function withBindEntry(binds: RuntimeCatalog['binds'], bind: RuntimeBind) {
  const { binds: page, app, intercept } = binds;
  const lists = { binds: [...page], app: [...app], intercept: [...intercept] };
  if (isPageBind(bind)) {
    lists.binds.push(bind);
  } else if (bind.kind === 'app') {
    lists.app.push(bind.bind);
  } else {
    lists.intercept.push(bind.bind);
  }
  return lists;
}

function withoutBindEntry(
  binds: RuntimeCatalog['binds'],
  entry: object,
): RuntimeCatalog['binds'] {
  return {
    binds: binds.binds.filter((each) => each !== entry),
    app: binds.app.filter((each) => each !== entry),
    intercept: binds.intercept.filter((each) => each !== entry),
  };
}

// `catalog` without `info` and the binds that name it, since the served keymap
// holds no bind whose command is gone.
function withoutCommand(
  catalog: RuntimeCatalog,
  info: CommandInfo,
): RuntimeCatalog {
  const namesOther = (bind: { command: CommandId }) => bind.command !== info.id;
  return {
    ...catalog,
    commands: catalog.commands.filter((each) => each !== info),
    binds: {
      binds: catalog.binds.binds.filter(namesOther),
      app: catalog.binds.app.filter(namesOther),
      intercept: catalog.binds.intercept.filter(namesOther),
    },
  };
}
