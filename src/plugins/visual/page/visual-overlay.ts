import type { PluginLog } from '../../../contracts/log';
import type { PluginAreas, PushedScope } from '../../../contracts/plugin';
import type {
  VisualFrame,
  VisualFrames,
} from '../../../contracts/visual-frames';
import { blurFocusedElement, element } from '../../../shared/page/dom';
import '../../../shared/page/ui/dialog.css';
import {
  type Drawn,
  openFrameSlot,
  type VisualParts,
} from './layout/visual-parts';

// The full-size overlay over a list of visuals' sources: `open` shows the
// visual at `index` and pushes the overlay's scope; `next` and `previous`
// step through the sources and stop at the ends; `close`, and the pushed
// scope's base changing, hide it and pop the scope. Each does nothing while
// the overlay is closed.
export interface VisualOverlay {
  open(sources: readonly string[], index: number): void;
  next(): void;
  previous(): void;
  close(): void;
}

// `pushScope` pushes the overlay's own scope; `onLayoutsChanged` hears each
// new set of visual layouts.
export interface VisualOverlayDeps {
  overlay: PluginAreas['overlay'];
  pushScope(): PushedScope;
  frames: VisualFrames;
  parts: VisualParts;
  log: PluginLog;
  onLayoutsChanged(listener: () => void): void;
}

// The shown visual: its own frame, the slot holding it and the part drawn
// around the slot.
interface Shown {
  frame: VisualFrame;
  slot: HTMLElement;
  drawn: Drawn;
}

interface OpenVisuals {
  sources: readonly string[];
  index: number;
  scope: PushedScope;
  shown: Shown | null;
}

// A dialog-layer surface in the overlay: the `overlay` part on the dim
// backdrop around a frame of its own, opened on the shown source, never the
// inline visual's. Each step disposes the last frame and opens the next; a
// layout change draws the part again around the same frame.
export function createVisualOverlay(deps: VisualOverlayDeps): VisualOverlay {
  const { log } = deps;
  const backdrop = element('div', 'ui-scrim visual-overlay');
  backdrop.hidden = true;
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  deps.overlay.contribute(backdrop);

  let open: OpenVisuals | null = null;
  const show = (opened: OpenVisuals, index: number) => {
    hide(opened.shown);
    opened.index = index;
    const { frame, slot } = openFrameSlot(deps.frames, opened.sources[index]);
    const input = { index, count: opened.sources.length };
    opened.shown = {
      frame,
      slot,
      drawn: deps.parts.overlay(backdrop, slot, input),
    };
    log(`visual overlay showing ${index + 1} of ${input.count}`);
  };
  const step = (direction: 1 | -1) => {
    if (open === null) {
      return;
    }
    const index = open.index + direction;
    if (index < 0 || index >= open.sources.length) {
      log(direction > 0 ? 'no next visual' : 'no previous visual');
      return;
    }
    show(open, index);
  };
  deps.onLayoutsChanged(() => {
    const held = open;
    if (held === null || held.shown === null) {
      return;
    }
    const { shown } = held;
    const input = { index: held.index, count: held.sources.length };
    const last = shown.drawn;
    shown.drawn = deps.parts.overlay(backdrop, shown.slot, input);
    last.dispose();
  });

  const overlay: VisualOverlay = {
    open(sources, index) {
      overlay.close();
      blurFocusedElement();
      const scope = deps.pushScope();
      const opened: OpenVisuals = { sources, index, scope, shown: null };
      scope.onBaseChanged(() => {
        if (open === opened) {
          overlay.close();
        }
      });
      open = opened;
      backdrop.hidden = false;
      show(opened, index);
    },
    next: () => step(1),
    previous: () => step(-1),
    close() {
      const held = open;
      if (held === null) {
        return;
      }
      open = null;
      backdrop.hidden = true;
      hide(held.shown);
      held.scope.pop();
      log('visual overlay closed');
    },
  };
  return overlay;
}

// Disposes the drawn part, then the frame.
function hide(shown: Shown | null): void {
  shown?.drawn.dispose();
  shown?.frame.dispose();
}
