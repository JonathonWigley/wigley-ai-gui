import type { Timers } from '../../contracts/ambient';
import type { DemoBeat } from '../../contracts/demo';
import type { Disposable } from '../../contracts/disposable';
import type { PluginLog } from '../../contracts/log';
import {
  activeForm,
  type SessionForm,
  type SessionFormsState,
} from './session-forms';

// How long a demo beat waits for its session's sample form to become active:
// a main launch and a form push.
export const DEMO_FORM_WAIT_MS = 5000;

// A form plugin's page store, the sessions plugin's `activate`, and the timers.
export interface DemoFormWaitDeps {
  store: {
    get(): SessionFormsState<SessionForm, string>;
    subscribe(listener: () => void): Disposable;
  };
  activate(sessionId: string): void;
  timers: Timers;
}

// Whether the store's active form is the form of `sessionId`.
export function isDemoFormActive(
  store: Pick<DemoFormWaitDeps['store'], 'get'>,
  sessionId: string,
): boolean {
  return activeForm(store.get())?.sessionId === sessionId;
}

// Activates `sessionId`, then resolves true once its form is the active form,
// checked now and on every store change, or false after DEMO_FORM_WAIT_MS.
// Either way it drops its subscription and its timer.
export function showDemoForm(
  deps: DemoFormWaitDeps,
  sessionId: string,
): Promise<boolean> {
  deps.activate(sessionId);
  if (isDemoFormActive(deps.store, sessionId)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const held: { subscription: Disposable | null; timer: number | null } = {
      subscription: null,
      timer: null,
    };
    const settle = (isShown: boolean) => {
      held.subscription?.dispose();
      if (held.timer !== null) {
        deps.timers.clear(held.timer);
      }
      resolve(isShown);
    };
    held.subscription = deps.store.subscribe(() => {
      if (isDemoFormActive(deps.store, sessionId)) {
        settle(true);
      }
    });
    held.timer = deps.timers.set(() => settle(false), DEMO_FORM_WAIT_MS);
  });
}

// A beat that shows `sessionId`'s sample form, then puts it in the beat's
// state through `run`. A form that never shows logs
// `demo form for <id> not shown` and runs nothing.
export function demoFormBeat(
  deps: DemoFormWaitDeps & { log: PluginLog },
  sessionId: string,
  name: string,
  run: () => Promise<void>,
): DemoBeat {
  return {
    name,
    show: async () => {
      if (!(await showDemoForm(deps, sessionId))) {
        deps.log(`demo form for ${sessionId} not shown`);
        return;
      }
      await run();
    },
  };
}
