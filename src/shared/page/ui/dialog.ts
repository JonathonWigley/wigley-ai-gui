import './dialog.css';
import { element } from '../dom';
import { openFloatingPanel } from './floating-panel';

// The app's copies of the layout kit's `DialogFrameInput` and `DialogFramePart`
// (`layout-host/kit.d.ts`), which this layer may not import;
// `layout-host/dialog-frame.test-d.ts` checks the copies equal.
// What a dialog's frame draws: its title, and whether it has an actions row.
export interface DialogFrameInput {
  title: string;
  hasActions: boolean;
}

// A dialog's frame: `element` is the panel appended to the parent; `body` and
// `actions` are inside it, and `actions` is null exactly when `hasActions` is
// false.
export interface DialogFramePart {
  element: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement | null;
}

// Draws a dialog's frame into `parent`, the scrim: the opener's layout part,
// which already checked the frame and fell back to `default`.
export type DrawDialogFrame = (
  parent: HTMLElement,
  input: DialogFrameInput,
) => DialogFramePart;

// `element` is the scrim and never changes. `panel` is the frame's panel inside
// it; `actions` is detached from the panel when the dialog was made without an
// actions row. Read `panel`, `body` and `actions` on each use: `redrawFrame`
// replaces them.
export interface Dialog {
  element: HTMLElement;
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  readonly actions: HTMLElement;
  setTitle(title: string): void;
  // Draws the frame again through `drawFrame`, moving the body's and actions'
  // nodes and their `hidden` into the new frame and keeping focus inside the
  // dialog; the scrim stays shown or hidden. A throw from `drawFrame`
  // propagates and leaves the earlier frame's fields in place, so a later call
  // retries.
  redrawFrame(): void;
  show(): void;
  hide(): void;
  isShown(): boolean;
}

// `hasActions: false` leaves the actions row out of the panel; true when left
// out. `drawFrame` draws the panel, title and actions row.
export interface DialogOptions {
  hasActions?: boolean;
  drawFrame: DrawDialogFrame;
}

// The frame inside the scrim, and how a title change and a redraw reach it.
interface Frame {
  panel: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  setTitle(title: string): void;
  redraw(): void;
}

// A modal dialog over the scrim, hidden until `show`. A click on the scrim
// does nothing: the caller owns the dialog's keys, which close it. The frame
// is drawn through `drawFrame` once here, and again on each `redrawFrame` and
// each `setTitle` that changes the title; the dialog marks the drawn panel
// `role="dialog"`, `aria-modal` and `aria-label` (the title) and adds no
// class.
export function createDialog(title: string, options: DialogOptions): Dialog {
  const scrim = element('div', 'ui-scrim');
  scrim.hidden = true;
  const frame = drawnFrame(
    scrim,
    title,
    options.hasActions ?? true,
    options.drawFrame,
  );
  return {
    element: scrim,
    get panel() {
      return frame.panel;
    },
    get body() {
      return frame.body;
    },
    get actions() {
      return frame.actions;
    },
    setTitle: (next) => frame.setTitle(next),
    redrawFrame: () => frame.redraw(),
    show() {
      openFloatingPanel(frame.panel, scrim);
    },
    hide() {
      scrim.hidden = true;
    },
    isShown: () => !scrim.hidden,
  };
}

// The frame `drawFrame` draws into the scrim. Its fields change only once a
// draw returns, so a throwing draw leaves the earlier frame's in place.
function drawnFrame(
  scrim: HTMLElement,
  title: string,
  hasActions: boolean,
  drawFrame: DrawDialogFrame,
): Frame {
  // The actions a dialog with no actions row hands its caller, never shown.
  const detachedActions = element('div', 'ui-dialog-actions');
  let currentTitle = title;
  const first = drawFrame(scrim, { title, hasActions });
  markDialog(first.element, title);
  const frame: Frame = {
    panel: first.element,
    body: first.body,
    actions: first.actions ?? detachedActions,
    setTitle(next) {
      if (next === currentTitle) {
        return;
      }
      currentTitle = next;
      frame.redraw();
    },
    redraw() {
      const active = document.activeElement;
      const focused =
        active instanceof HTMLElement && scrim.contains(active) ? active : null;
      const next = drawFrame(scrim, { title: currentTitle, hasActions });
      moveContent(frame.body, next.body);
      if (next.actions !== null) {
        moveContent(frame.actions, next.actions);
      }
      // `LayoutParts.redraw` may have removed the earlier panel already.
      frame.panel.remove();
      markDialog(next.element, currentTitle);
      frame.panel = next.element;
      frame.body = next.body;
      frame.actions = next.actions ?? detachedActions;
      // Moving a node blurs it.
      const isFocusLost =
        focused !== null &&
        scrim.contains(focused) &&
        document.activeElement !== focused;
      if (isFocusLost) {
        focused.focus({ preventScroll: true });
      }
    },
  };
  return frame;
}

// Marks a drawn panel as the modal dialog named `title`.
function markDialog(panel: HTMLElement, title: string): void {
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
}

// Appends every child node of `from` to `to`, after what `to` holds, and
// carries `from`'s `hidden` over.
function moveContent(from: HTMLElement, to: HTMLElement): void {
  to.append(...Array.from(from.childNodes));
  to.hidden = from.hidden;
}

// Focus left on the closed `dialog`, or on nothing, goes back to
// `focusedBefore`, what held it as the dialog opened; focus that moved
// elsewhere meanwhile stays.
export function restoreFocusAfterDialog(
  dialog: Dialog,
  focusedBefore: Element | null,
): void {
  const active = document.activeElement;
  const isFocusLost =
    active === null ||
    active === document.body ||
    dialog.element.contains(active);
  if (
    isFocusLost &&
    focusedBefore instanceof HTMLElement &&
    focusedBefore.isConnected
  ) {
    focusedBefore.focus();
  }
}
