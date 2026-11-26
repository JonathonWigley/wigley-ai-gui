import type { Disposable } from '../../contracts/disposable';
import type {
  TerminalEmulator,
  TerminalPalette,
  TerminalScreen,
  TerminalScreenOptions,
  TerminalSize,
} from '../../contracts/terminal-emulator';

export interface FakeTerminalScreenRecord {
  readonly options: TerminalScreenOptions;
  readonly screen: TerminalScreen;
  written: string[];
  palettes: {
    palette: TerminalPalette;
    fontFamily: string;
    fontSize: number;
  }[];
  fits: number;
  focuses: number;
  resets: number;
  disposed: boolean;
  size: TerminalSize;
  type(data: string): void; // runs the screen's onInput listeners with `data`
  resizeTo(size: TerminalSize): void; // sets `size`, then runs the onResize listeners
}

export interface FakeTerminalEmulator extends TerminalEmulator {
  readonly screens: readonly FakeTerminalScreenRecord[];
}

const START_SIZE: TerminalSize = { cols: 80, rows: 24 };

function listen<T>(listeners: Set<(value: T) => void>) {
  return (listener: (value: T) => void): Disposable => {
    listeners.add(listener);
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  };
}

// A `TerminalEmulator` for plugin tests: `screens` holds each screen made, in
// order, with what was written to it and done to it. A screen's element is a
// `div.terminal-screen` made through `document`, so a test installs the fake
// DOM; its `dispose` removes the element and drops its listeners, once.
export function createFakeTerminalEmulator(): FakeTerminalEmulator {
  const screens: FakeTerminalScreenRecord[] = [];
  return {
    screens,
    create: (options) => {
      const element = document.createElement('div');
      element.className = 'terminal-screen';
      const inputListeners = new Set<(data: string) => void>();
      const resizeListeners = new Set<(size: TerminalSize) => void>();
      const screen: TerminalScreen = {
        element,
        write: (data) => {
          record.written.push(data);
        },
        onInput: listen(inputListeners),
        onResize: listen(resizeListeners),
        size: () => record.size,
        fit: () => {
          record.fits += 1;
        },
        focus: () => {
          record.focuses += 1;
        },
        setPalette: (palette, fontFamily, fontSize) => {
          record.palettes.push({ palette, fontFamily, fontSize });
        },
        reset: () => {
          record.resets += 1;
        },
        dispose: () => {
          if (record.disposed) {
            return;
          }
          record.disposed = true;
          element.remove();
          inputListeners.clear();
          resizeListeners.clear();
        },
      };
      const record: FakeTerminalScreenRecord = {
        options,
        screen,
        written: [],
        palettes: [],
        fits: 0,
        focuses: 0,
        resets: 0,
        disposed: false,
        size: { ...START_SIZE },
        type: (data) => {
          for (const listener of inputListeners) {
            listener(data);
          }
        },
        resizeTo: (size) => {
          record.size = size;
          for (const listener of resizeListeners) {
            listener(size);
          }
        },
      };
      screens.push(record);
      return screen;
    },
  };
}
