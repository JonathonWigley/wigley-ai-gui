import type {
  ConsoleMessage,
  DrivenInput,
  DrivenWindow,
} from './driven-window';

// A script fragment and the answer the fake gives a script holding it.
export type FakeAnswer = [fragment: string, answer: () => unknown];

// A `DrivenWindow` for the drive tests. It records the input it is sent and
// how often it was focused and had focus emulated, answers each script `run` gets from the first
// table entry whose fragment the script holds (throwing when none does), and
// lets a test paint frames and write console messages to its listeners.
export function fakeDrivenWindow(answers: FakeAnswer[] = []) {
  const inputs: DrivenInput[] = [];
  const frameListeners = new Set<(png: () => Uint8Array, at: number) => void>();
  const consoleListeners = new Set<(message: ConsoleMessage) => void>();
  const focused = { count: 0, emulated: 0 };
  const window: DrivenWindow = {
    sendInput: (input) => inputs.push(input),
    async run<T>(script: string) {
      const entry = answers.find(([fragment]) => script.includes(fragment));
      if (entry === undefined) {
        throw new Error(`The fake window has no answer for ${script}`);
      }
      return entry[1]() as T;
    },
    capture: async () => null,
    contentSize: () => ({ width: 800, height: 600 }),
    minimumWidth: () => 400,
    setContentWidth: () => {},
    setSize: () => {},
    focus: () => {
      focused.count += 1;
    },
    emulateFocus: async () => {
      focused.emulated += 1;
    },
    hasPaintedSinceNavigation: () => true,
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
  return { window, inputs, focused, paint, writeConsole };
}
