import type { DemoStepRegistry } from '../contracts/demo';
import type { Registrations } from '../contracts/disposable';

// The core demo-step registry, one per process. `register` throws `demo step
// "<id>" is already registered` while a live registration holds the id; a
// registration's first `dispose` removes the step, and the id may register
// again. Listeners hear each register and each first `dispose`, synchronously.
export function createDemoStepRegistry<
  S extends { id: string },
>(): DemoStepRegistry<S> {
  const steps = new Map<string, S>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    register(step) {
      if (steps.has(step.id)) {
        throw new Error(`demo step "${step.id}" is already registered`);
      }
      steps.set(step.id, step);
      notify();
      let isDisposed = false;
      return {
        dispose() {
          if (!isDisposed) {
            isDisposed = true;
            steps.delete(step.id);
            notify();
          }
        },
      };
    },
    list: () => [...steps.values()],
    onChanged(listener) {
      const entry = () => listener();
      listeners.add(entry);
      return { dispose: () => listeners.delete(entry) };
    },
  };
}

// One plugin's view of `registry`: `register` throws `demo step "<id>" must
// start with "<pluginId>."` for an id without that prefix or with nothing after
// it, before `registry` sees the step. `registrations` disposing it disposes
// every step and listener the plugin added; `list` reads every plugin's steps.
export function pluginDemoSteps<S extends { id: string }>(
  registry: DemoStepRegistry<S>,
  pluginId: string,
  registrations: Registrations,
): DemoStepRegistry<S> {
  const prefix = `${pluginId}.`;
  return {
    register(step) {
      const hasNameAfterPrefix =
        step.id.startsWith(prefix) && step.id.length > prefix.length;
      if (!hasNameAfterPrefix) {
        throw new Error(`demo step "${step.id}" must start with "${prefix}"`);
      }
      return registrations.track(registry.register(step));
    },
    list: () => registry.list(),
    onChanged: (listener) => registrations.track(registry.onChanged(listener)),
  };
}
