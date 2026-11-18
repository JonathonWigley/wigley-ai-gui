import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { ViewScope } from '../../contracts/keymap';
import type { SlotReader } from '../../contracts/state';

// How long `open` waits for chat's start prompt to show.
export const DEMO_PROMPT_WAIT_MS = 5000;

const PROMPT_SCOPE = 'chat.picker';
const NEW_SESSION = 'chat.newSession';
const PICKER_CANCEL = 'chat.pickerCancel';

// `runCommand` runs a command by its qualified id; `scope` is the page key
// scope (`coreScopeSlot`).
export interface DemoStartPromptDeps {
  runCommand(id: string): void;
  scope: SlotReader<ViewScope>;
  timers: Timers;
  log(line: string): void;
}

// A demo stage's hold on chat's start prompt, which shows while the key scope
// reads `chat.picker`. `open` resolves true once the prompt shows, at once when
// it already shows from an earlier `open`, else after running `chat.newSession`;
// it resolves false when the prompt has not shown after `DEMO_PROMPT_WAIT_MS`.
// `isOpen` is true from `open`'s true until the scope leaves the prompt.
// `cancel` closes a prompt `open` showed, and makes a still waiting `open` close
// the prompt the moment it shows and resolve false; a later `open` takes the
// wait back. `dispose` cancels.
export interface DemoStartPrompt extends Disposable {
  open(): Promise<boolean>;
  isOpen(): boolean;
  cancel(): void;
}

// One `open`'s wait for the prompt; `isWaiting` turns false when it resolves.
interface Wait {
  shown: Promise<boolean>;
  isWaiting: boolean;
  cancelsOnShow: boolean;
}

export function demoStartPrompt(deps: DemoStartPromptDeps): DemoStartPrompt {
  // Listens for the scope leaving the prompt while `open` holds it shown.
  let shownWatch: Disposable | null = null;
  let wait: Wait | null = null;

  const watchShown = () => {
    const watch = deps.scope.on((scope) => {
      if (scope !== PROMPT_SCOPE && shownWatch === watch) {
        watch.dispose();
        shownWatch = null;
      }
    });
    shownWatch = watch;
  };

  const waitForPrompt = (): Wait => {
    let settle: (isShown: boolean) => void = () => {};
    const started: Wait = {
      shown: new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
      isWaiting: true,
      cancelsOnShow: false,
    };
    const end = (isShown: boolean) => {
      started.isWaiting = false;
      subscription.dispose();
      deps.timers.clear(timer);
      settle(isShown);
    };
    const check = () => {
      if (!started.isWaiting || deps.scope.get() !== PROMPT_SCOPE) {
        return;
      }
      if (started.cancelsOnShow) {
        deps.runCommand(PICKER_CANCEL);
        end(false);
        return;
      }
      watchShown();
      end(true);
    };
    const subscription = deps.scope.on(check);
    const timer = deps.timers.set(() => {
      deps.log('demo start prompt not shown');
      end(false);
    }, DEMO_PROMPT_WAIT_MS);
    deps.runCommand(NEW_SESSION);
    check();
    return started;
  };

  const prompt: DemoStartPrompt = {
    open() {
      if (prompt.isOpen()) {
        return Promise.resolve(true);
      }
      if (wait === null || !wait.isWaiting) {
        wait = waitForPrompt();
      }
      wait.cancelsOnShow = false;
      return wait.shown;
    },
    isOpen: () => shownWatch !== null,
    cancel() {
      if (wait?.isWaiting === true) {
        wait.cancelsOnShow = true;
      }
      if (prompt.isOpen()) {
        deps.runCommand(PICKER_CANCEL);
      }
    },
    dispose: () => prompt.cancel(),
  };
  return prompt;
}
