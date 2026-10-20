import type { Log } from '../../contracts/log';
import type { Mode, ModeHandle, Modes } from '../../contracts/plugin';

// The core's mode registry: `attach` places each mode's element in the window
// once, and showing a mode only toggles `hidden`, so a hidden mode keeps its
// DOM and state.
export function createModes(
  attach: (element: HTMLElement) => void,
  log: Log,
): Modes {
  const added = new Map<string, Mode>();
  const listeners: ((modeId: string) => void)[] = [];
  let shownMode: Mode | null = null;

  const reveal = (mode: Mode) => {
    mode.element.hidden = false;
    shownMode = mode;
    log('page', `showed ${mode.title} mode`);
    mode.shown();
  };

  return {
    add(mode) {
      if (added.has(mode.id)) {
        throw new Error(`Mode "${mode.id}" is added twice`);
      }
      added.set(mode.id, mode);
      attach(mode.element);
      if (shownMode === null) {
        reveal(mode);
      } else {
        mode.element.hidden = true;
      }
      const handle: ModeHandle = {
        show() {
          if (shownMode === mode) {
            return;
          }
          if (shownMode !== null) {
            shownMode.element.hidden = true;
            shownMode.hidden();
          }
          reveal(mode);
          for (const listener of listeners) {
            listener(mode.id);
          }
        },
        isShown: () => shownMode === mode,
      };
      return handle;
    },
    shown() {
      if (shownMode === null) {
        throw new Error('No mode is added yet');
      }
      return shownMode.id;
    },
    onChanged(listener) {
      listeners.push(listener);
    },
  };
}
