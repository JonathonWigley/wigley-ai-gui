import type { Disposable } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type {
  EventShape,
  PluginEvents,
  UntypedEvents,
} from '../contracts/plugin';
import { errorText } from './error-text';
import { createListeners, type Listeners } from './listeners';
import { qualify } from './plugin-manifests';

// One process's events, each under its qualified name. `emit` runs the
// listeners of exactly that name in subscription order before it returns; a
// listener's throw leaves `emit` and skips the listeners after it, and one
// added during an emit hears only later emits. `on` hears until the returned
// handle's `dispose`, a registration disposed during an emit hears no more of
// it, and each registration of one listener is disposed on its own.
export interface EventBus {
  emit(qualifiedEvent: string, data: unknown): void;
  on(qualifiedEvent: string, listener: (data: unknown) => void): Disposable;
}

type Listener = (data: unknown) => void;

export function createEventBus(): EventBus {
  const listeners = new Map<string, Listeners<unknown>>();

  return {
    emit: (qualifiedEvent, data) => {
      listeners.get(qualifiedEvent)?.tell(data);
    },
    on: (qualifiedEvent, listener) => {
      const named = listeners.get(qualifiedEvent) ?? createListeners<unknown>();
      listeners.set(qualifiedEvent, named);
      return named.add(listener);
    },
  };
}

// One plugin's view of `bus`: it emits its events `Ev` under its own id and
// hears the events `Heard` lists by their qualified names. The bus itself is
// untyped, so the types are the caller's word. Each listener `on` adds is
// wrapped: its throw is logged under `pluginId`, the listening plugin, as
// `<qualifiedEvent> listener failed: <error>`, and the other listeners still
// run.
export function pluginEvents<
  Ev extends EventShape = UntypedEvents,
  Heard extends EventShape = UntypedEvents,
>(bus: EventBus, pluginId: string, log: Log): PluginEvents<Ev, Heard> {
  return {
    emit: (event, data) => bus.emit(qualify(pluginId, event), data),
    on: (qualifiedEvent, listener) =>
      bus.on(qualifiedEvent, (data) => {
        try {
          (listener as Listener)(data);
        } catch (error) {
          log(
            pluginId,
            `${qualifiedEvent} listener failed: ${errorText(error)}`,
          );
        }
      }),
  };
}
