import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import type {
  VisualFrame,
  VisualFrames,
} from '../../../../contracts/visual-frames';
import { appended, element, moveConnected } from '../../../../shared/page/dom';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import type { OwnerKitServices } from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import type {
  CompleteLayout,
  Layout,
  OverlayInput,
} from '../../layouts/layout';
import { visualManifest } from '../../manifest';
import {
  createOverlayKit,
  createVisualBaseKit,
  createVisualKit,
} from './visual-kit';

// A drawn part. `element` is the part's root; `dispose` removes the
// `div.visual-draw` it was drawn into and disposes every anchor the part
// named.
export interface Drawn {
  element: HTMLElement;
  dispose(): void;
}

export interface VisualPartsDeps {
  defaultLayout: CompleteLayout;
  kit: OwnerKitServices;
  log: Log;
}

// Draws each visual part into a fresh `div.visual-draw` appended to `parent`,
// with the layouts last set, `default` alone until the first `setLayouts`.
// Each part picks its own layout and falls back to `default` on a throw.
// `visual` and `overlay` place `frame`, the app's frame slot, where the part
// calls `kit.frame`, else at the end of its root; drawn again with the same
// `frame`, each moves the slot, and the visual stays loaded only when the
// slot and the element it moves into are both in the document: a part that
// places it in a detached element, or whose draw throws, reloads it. `visual`
// also places an expand button whose click runs `expand`, where the part calls
// `kit.expand`, else at its root's end after the frame. `card` and `overlay`
// anchor keys in no scope and the overlay's scope, `visual` in chat's.
// `setLayouts` only stores the set; the fence and the overlay draw again.
export interface VisualParts {
  card(parent: HTMLElement): Drawn;
  visual(parent: HTMLElement, frame: HTMLElement, expand: () => void): Drawn;
  overlay(parent: HTMLElement, frame: HTMLElement, input: OverlayInput): Drawn;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

type PartName = keyof CompleteLayout;

// `kit.frame`'s slot for one drawing attempt: `appSlot`'s shape, but it moves
// the slot through `moveConnected`, so the frame inside it stays loaded when
// both are in the document.
interface FrameSlot {
  // Moves the slot to the end of `at` and returns it; throws
  // `frame placed twice` on a second call.
  place(at: HTMLElement): HTMLElement;
  // Moves the slot to the end of `root` when no `place` call placed it.
  placeIfLeftOut(root: HTMLElement): void;
}

export function createVisualParts(deps: VisualPartsDeps): VisualParts {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: visualManifest.id,
    defaultLayout: deps.defaultLayout,
    log: deps.log,
  });

  // Draws `part` into a fresh `div.visual-draw` appended to `parent`; `call`
  // runs the builder with a kit whose anchors `rollback` records. A draw that
  // throws leaves no `div.visual-draw` behind.
  const draw = <P extends PartName>(
    part: P,
    parent: HTMLElement,
    call: (
      builder: CompleteLayout[P],
      slot: HTMLElement,
      rollback: RollbackDeps,
    ) => HTMLElement,
  ): Drawn => {
    const into = appended(parent, element('div', 'visual-draw'));
    try {
      const drawn = layoutParts.draw(part, into, (builder, slot, rollback) => ({
        element: call(builder, slot, rollback),
      }));
      return {
        element: drawn.built.element,
        dispose() {
          into.remove();
          drawn.dispose();
        },
      };
    } catch (error) {
      into.remove();
      throw error;
    }
  };

  return {
    card(parent) {
      return draw('card', parent, (card, slot, rollback) =>
        card(slot, createVisualBaseKit(deps.kit, rollback, null)),
      );
    },
    visual(parent, frame, expand) {
      return draw('visual', parent, (visual, slot, rollback) => {
        const frameSlot = createFrameSlot(frame, rollback);
        const button = iconButton('screen-full', 'Expand', expand, 'sm');
        const expandSlot = appSlot(button, 'expand', rollback);
        const root = visual(
          slot,
          createVisualKit(
            deps.kit,
            rollback,
            (at) => frameSlot.place(at),
            (at) => {
              expandSlot.place(at);
              return button;
            },
          ),
        );
        frameSlot.placeIfLeftOut(root);
        expandSlot.placeIfLeftOut(root);
        return root;
      });
    },
    overlay(parent, frame, input) {
      return draw('overlay', parent, (overlay, slot, rollback) => {
        const frameSlot = createFrameSlot(frame, rollback);
        const root = overlay(
          slot,
          input,
          createOverlayKit(deps.kit, rollback, (at) => frameSlot.place(at)),
        );
        frameSlot.placeIfLeftOut(root);
        return root;
      });
    },
    setLayouts: layoutParts.setLayouts,
  };
}

// A frame opened on `source`, in the `div.visual-frame-slot` a part's
// `kit.frame` places.
export function openFrameSlot(
  frames: VisualFrames,
  source: string,
): { frame: VisualFrame; slot: HTMLElement } {
  const frame = frames.open(source);
  const slot = element('div', 'visual-frame-slot');
  slot.append(frame.element);
  return { frame, slot };
}

// Placing `slot` records, through `rollback`, a destroy that detaches it while
// it still sits where this attempt put it, so a later draw that moved it keeps
// it when this one is disposed, and a throwing attempt leaves it detached.
function createFrameSlot(
  slot: HTMLElement,
  rollback: Pick<RollbackDeps, 'recordBox'>,
): FrameSlot {
  let isPlaced = false;
  const place = (at: HTMLElement) => {
    if (isPlaced) {
      throw new Error('frame placed twice');
    }
    isPlaced = true;
    moveConnected(at, slot);
    rollback.recordBox(() => {
      if (slot.parentNode === at) {
        slot.remove();
      }
    });
    return slot;
  };
  return {
    place,
    placeIfLeftOut(root) {
      if (!isPlaced) {
        place(root);
      }
    },
  };
}
