import {
  type ConsoleMessage,
  type DrivenInput,
  createPendingRuns,
  type DrivenWindow,
} from './driven-window';

// A script fragment and the answer the fake gives a script holding it.
export type FakeAnswer = [fragment: string, answer: () => unknown];

// A `DrivenWindow` for the drive tests. It records the input it is sent and
// how often it was focused and had focus emulated, rejects `emulateFocus`
// with `focused.failure` while a test sets one, answers each script `run`
// gets from the first table entry whose fragment the script holds (throwing
// when none does), keeps the content size `setContentWidth` and `setSize` set
// (800 x 600 at start) for `contentSize` to return, resolves `capture` to
// `screen.captured`, counts the navigations a test makes with `navigate`, and
// lets a test paint frames and write console messages to its listeners. As the
// Electron adapter does, `navigate` rejects every `run` still pending with
// `PageNavigatedError`; an answer that returns a promise which never settles
// models a lost call.
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
  const size = { width: 800, height: 600 };
  let navigations = 0;
  const pendingRuns = createPendingRuns();
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
    run: <T>(script: string) => pendingRuns.track(() => answer<T>(script)),
    capture: async () => screen.captured,
    contentSize: () => ({ ...size }),
    minimumWidth: () => 400,
    setContentWidth: (width) => {
      size.width = width;
    },
    setSize: (width, height) => {
      size.width = width;
      size.height = height;
    },
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
    pendingRuns.rejectAll();
  };
  return { window, inputs, focused, screen, navigate, paint, writeConsole };
}
