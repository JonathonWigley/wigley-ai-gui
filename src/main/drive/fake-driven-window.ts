import {
  type ConsoleMessage,
  type DrivenInput,
  type DrivenWindow,
  PageNavigatedError,
} from './driven-window';

// A script fragment and the answer the fake gives a script holding it.
export type FakeAnswer = [fragment: string, answer: () => unknown];

// A `DrivenWindow` for the drive tests. It records the input it is sent and
// how often it was focused and had focus emulated, rejects `emulateFocus`
// with `focused.failure` while a test sets one, answers each script `run`
// gets from the first table entry whose fragment the script holds (throwing
// when none does), resolves `capture` to `screen.captured`, counts the
// navigations a test makes with `navigate`, and lets a test paint frames and
// write console messages to its listeners. As the Electron adapter does,
// `navigate` rejects every `run` still pending with `PageNavigatedError`; an
// answer that returns a promise which never settles models a lost call.
export function fakeDrivenWindow(answers: FakeAnswer[] = []) {
  const inputs: DrivenInput[] = [];
  const frameListeners = new Set<(png: () => Uint8Array, at: number) => void>();
  const consoleListeners = new Set<(message: ConsoleMessage) => void>();
  const focused: { count: number; emulated: number; failure: Error | null } = {
    count: 0,
    emulated: 0,
    failure: null,
  };
  const screen: { captured: Uint8Array | null } = { captured: null };
  let navigations = 0;
  // The reject of every `run` call not yet settled.
  const pendingRuns = new Set<(error: Error) => void>();
  const answer = async <T>(script: string) => {
    const entry = answers.find(([fragment]) => script.includes(fragment));
    if (entry === undefined) {
      throw new Error(`The fake window has no answer for ${script}`);
    }
    return entry[1]() as T;
  };
  const window: DrivenWindow = {
    sendInput: (input) => inputs.push(input),
    // Pending before the answer is asked for, so an answer that navigates
    // rejects its own call.
    run: <T>(script: string) =>
      new Promise<T>((resolve, reject) => {
        pendingRuns.add(reject);
        answer<T>(script)
          .then(resolve, reject)
          .finally(() => pendingRuns.delete(reject));
      }),
    capture: async () => screen.captured,
    contentSize: () => ({ width: 800, height: 600 }),
    minimumWidth: () => 400,
    setContentWidth: () => {},
    setSize: () => {},
    focus: () => {
      focused.count += 1;
    },
    emulateFocus: async () => {
      if (focused.failure !== null) {
        throw focused.failure;
      }
      focused.emulated += 1;
    },
    hasPaintedSinceNavigation: () => true,
    navigationCount: () => navigations,
    onFrame: (listener) => {
      frameListeners.add(listener);
      return { dispose: () => frameListeners.delete(listener) };
    },
    onConsole: (listener) => {
      consoleListeners.add(listener);
      return { dispose: () => consoleListeners.delete(listener) };
    },
  };
  const paint = (png: Uint8Array, at: number) => {
    for (const listener of frameListeners) {
      listener(() => png, at);
    }
  };
  const writeConsole = (message: ConsoleMessage) => {
    for (const listener of consoleListeners) {
      listener(message);
    }
  };
  const navigate = () => {
    navigations += 1;
    for (const reject of pendingRuns) {
      reject(new PageNavigatedError());
    }
    pendingRuns.clear();
  };
  return { window, inputs, focused, screen, navigate, paint, writeConsole };
}
