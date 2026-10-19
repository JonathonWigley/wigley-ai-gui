import type {
  EventShape,
  PluginEvents,
  UntypedEvents,
} from '../contracts/plugin';
import { qualify } from './plugin-manifests';

// One process's events, each under its qualified name. `emit` runs the
// listeners of exactly that name in subscription order before it returns; a
// listener's throw leaves `emit` and skips the listeners after it, and one
// added during an emit hears only later emits.
export interface EventBus {
  emit(qualifiedEvent: string, data: unknown): void;
  on(qualifiedEvent: string, listener: (data: unknown) => void): void;
}

type Listener = (data: unknown) => void;

export function createEventBus(): EventBus {
  const listeners = new Map<string, Listener[]>();

  return {
    emit: (qualifiedEvent, data) => {
      for (const listener of listeners.get(qualifiedEvent)?.slice() ?? []) {
        listener(data);
      }
    },
    on: (qualifiedEvent, listener) => {
      const named = listeners.get(qualifiedEvent) ?? [];
      named.push(listener);
      listeners.set(qualifiedEvent, named);
    },
  };
}

// One plugin's view of `bus`: it emits its events `Ev` under its own id and
// hears the events `Heard` lists by their qualified names. The bus itself is
// untyped, so the types are the caller's word.
export function pluginEvents<
  Ev extends EventShape = UntypedEvents,
  Heard extends EventShape = UntypedEvents,
>(bus: EventBus, pluginId: string): PluginEvents<Ev, Heard> {
  return {
    emit: (event, data) => bus.emit(qualify(pluginId, event), data),
    on: (qualifiedEvent, listener) =>
      bus.on(qualifiedEvent, listener as Listener),
  };
}
