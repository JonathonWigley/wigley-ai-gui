import type { CommandId, CommandRunContext } from '../contracts/commands';
import type { Disposable } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type { CommandHandler } from '../contracts/plugin';
import { errorText } from './error-text';

type Wrap = (
  next: () => Promise<void>,
  context: CommandRunContext,
) => void | Promise<void>;

interface Owned<T> {
  value: T;
  owner: string;
}

// The promise of `start`'s run, which never rejects: a throw or a rejection goes
// to `failed`. `start` runs before this returns.
function settled(
  start: () => void | Promise<void>,
  failed: (error: unknown) => void,
): Promise<void> {
  try {
    return Promise.resolve(start()).catch(failed);
  } catch (error) {
    failed(error);
    return Promise.resolve();
  }
}

// Maps command ids to what they do in this process. `Context` is what the trigger
// hands the command: its argument, and the editor it fired in or the chord that
// fired it. `log` takes each failure under the plugin that owns what failed.
export class CommandRegistry<Context extends { arg: unknown }> {
  private readonly handlers = new Map<
    CommandId,
    Owned<CommandHandler<Context>>
  >();
  private readonly wraps = new Map<CommandId, Owned<Wrap>[]>();
  private readonly didRunListeners = new Set<
    Owned<(id: CommandId, arg: unknown) => void>
  >();

  constructor(private readonly log: Log) {}

  // The returned handle's `dispose` unregisters the command while `handler` is
  // still the one registered under `id`, and otherwise does nothing.
  register(
    id: CommandId,
    handler: CommandHandler<Context>,
    owner: string,
  ): Disposable {
    if (this.handlers.has(id)) {
      throw new Error(`Command "${id}" is already registered`);
    }
    const entry = { value: handler, owner };
    this.handlers.set(id, entry);
    return {
      dispose: () => {
        if (this.handlers.get(id) === entry) {
          this.handlers.delete(id);
        }
      },
    };
  }

  has(id: CommandId): boolean {
    return this.handlers.has(id);
  }

  // Throws for an id with no handler. Otherwise it resolves once the run settles,
  // and never rejects: a failure of the handler or a wrap is logged under its
  // owner. With no intercept in the way the handler starts before this returns,
  // since the key engine reads focus right after a run.
  run(id: CommandId, context: Context): Promise<void> {
    const handler = this.handlers.get(id);
    if (handler === undefined) {
      throw new Error(`No command is registered as "${id}"`);
    }
    const wraps = [...(this.wraps.get(id) ?? [])];
    const runContext: CommandRunContext = { id, arg: context.arg };
    let hasFailed = false;
    let handlerRun: Promise<void> | null = null;
    const runHandler = (): Promise<void> => {
      handlerRun = settled(
        () => handler.value(context),
        (error) => {
          hasFailed = true;
          this.log(handler.owner, `command ${id} failed: ${errorText(error)}`);
        },
      );
      return handlerRun;
    };
    // The chain from wrap `index` inward; a second `next` of one wrap does nothing.
    const runFrom = (index: number): Promise<void> => {
      if (index < 0) {
        return runHandler();
      }
      const wrap = wraps[index];
      let inner: Promise<void> | null = null;
      const next = () => (inner ??= runFrom(index - 1));
      return settled(
        () => wrap.value(next, runContext),
        (error) => {
          hasFailed = true;
          this.log(
            wrap.owner,
            `intercept of ${id} failed: ${errorText(error)}`,
          );
        },
      );
    };
    const chain = runFrom(wraps.length - 1);
    return chain.then(async () => {
      if (handlerRun === null) {
        return;
      }
      await handlerRun;
      if (!hasFailed) {
        this.tellDidRun(id, context.arg);
      }
    });
  }

  // Wraps every later run of `id` here; the last registered is outermost. A wrap
  // calls `next` before its own promise settles: a later `next` still runs the
  // handler, but `run` has resolved and `onDidRun` hears nothing of it.
  intercept(id: CommandId, wrap: Wrap, owner: string): Disposable {
    const entry = { value: wrap, owner };
    const wraps = this.wraps.get(id) ?? [];
    wraps.push(entry);
    this.wraps.set(id, wraps);
    return {
      dispose: () => {
        const index = wraps.indexOf(entry);
        if (index !== -1) {
          wraps.splice(index, 1);
        }
      },
    };
  }

  // Hears each run that ended with no failure, once the handler has settled. A
  // listener's throw is logged under its owner, and the other listeners run.
  onDidRun(
    listener: (id: CommandId, arg: unknown) => void,
    owner: string,
  ): Disposable {
    const entry = { value: listener, owner };
    this.didRunListeners.add(entry);
    return { dispose: () => this.didRunListeners.delete(entry) };
  }

  // Fails at startup on a keymap naming a command nothing registered, instead
  // of on the first press of its key.
  requireRegistered(ids: Iterable<CommandId>): void {
    const missing = [...new Set(ids)].filter((id) => !this.handlers.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Keymap names unregistered commands: ${missing.join(', ')}`,
      );
    }
  }

  private tellDidRun(id: CommandId, arg: unknown): void {
    for (const { value: listener, owner } of this.didRunListeners) {
      try {
        listener(id, arg);
      } catch (error) {
        this.log(
          owner,
          `listener of command ${id} failed: ${errorText(error)}`,
        );
      }
    }
  }
}
