import type { Disposable } from '../../../contracts/disposable';
import {
  DEFAULT_LAYOUT_NAME,
  type LayoutOwner,
} from '../../../contracts/layouts';
import type { PluginLog } from '../../../contracts/log';
import { callEach } from '../../call-each';
import { errorText } from '../../error-text';
import type { DialogFrameInput, DialogFramePart } from '../ui/dialog';

// The layout picked to draw a part, and its name.
export interface PartPick<L> {
  name: string;
  layout: L;
}

// What a part's build records for its rollback and its dispose: the destroy of
// each box it mounts and each key anchor it names.
export interface RollbackDeps {
  recordBox(destroy: () => void): void;
  recordAnchor(anchor: Disposable): void;
}

// `owner` is set as `data-layout-owner` on the part root. `part` reads the
// part's builder from a layout, undefined when the layout lacks the part;
// `build` draws the builder into `parent` and returns the owner's own object,
// whose `element` it appended to `parent`. `partName` names the part in each
// error and log line (`rail`, `question card`).
export interface DrawPartOptions<
  L extends object,
  B,
  R extends { element: HTMLElement },
> {
  owner: LayoutOwner;
  parent: HTMLElement;
  pick: PartPick<L>;
  defaultLayout: L;
  part(layout: L): B | undefined;
  build(builder: B, parent: HTMLElement, rollback: RollbackDeps): R;
  log: PluginLog;
  partName: string;
}

// A drawn part: the owner's built object, the name of the layout that drew it,
// whether `defaultLayout` itself drew it: picked, or in the picked layout's
// place, and the dispose of every anchor and box its build recorded.
export interface DrawnPart<R> {
  built: R;
  layoutName: string;
  drewBundled: boolean;
  dispose(): void;
}

// Disposes each of `draws`; returns the empty list that replaces them.
export function disposeDraws<R>(
  draws: readonly DrawnPart<R>[],
): DrawnPart<R>[] {
  for (const draw of draws) {
    draw.dispose();
  }
  return [];
}

// The part names whose failure was logged, by the layout object that failed.
// The loader makes a new layout object for each revision, so a new revision
// logs again.
const loggedFailures = new WeakMap<object, Set<string>>();

// Draws the part with the picked layout when it defines the part and is not
// `defaultLayout` (a live default picked as `default` is attempted), else with
// `defaultLayout` as `default`. Each attempt builds with a fresh recorder and
// must return an element appended to `parent`. When the picked attempt throws,
// it is rolled back (each recorded box destroyed, each recorded anchor
// disposed, each node it appended to `parent` removed),
// `layout <name> <partName> failed: <error>` goes to `log` once
// per layout object and part name, and `defaultLayout` draws in its place. An
// attempt that leaves `parent` holding a new node beside its element fails the
// same way. A throw from the `defaultLayout` attempt rolls back the same way
// and is rethrown, with no log. Throws `layout default has no <partName>` when
// `defaultLayout` must draw a part it lacks. `built.element` carries
// `data-layout="<layoutName>"` and `data-layout-owner="<owner>"`. `dispose`
// disposes every anchor and runs every box destroy the drawing attempt
// recorded, once; a second call does nothing. It does not remove
// `built.element`.
export function drawPart<
  L extends object,
  B,
  R extends { element: HTMLElement },
>(options: DrawPartOptions<L, B, R>): DrawnPart<R> {
  const { pick } = options;
  const picked = options.part(pick.layout);
  const isBundledPick = pick.layout === options.defaultLayout;
  if (picked !== undefined && !isBundledPick) {
    try {
      return attempt(options, picked, pick.name, false);
    } catch (error) {
      logFailureOnce(options, error);
    }
  }
  const builder = options.part(options.defaultLayout);
  if (builder === undefined) {
    throw new Error(`layout ${DEFAULT_LAYOUT_NAME} has no ${options.partName}`);
  }
  return attempt(options, builder, DEFAULT_LAYOUT_NAME, true);
}

// A layout's part must return an element it appended to `parent`: the host
// shows, hides and marks that node. Throws `<partName> returned no element`
// for anything but an element, and
// `<partName>'s element is not appended to parent` for one elsewhere.
export function requireElementIn(
  parent: HTMLElement,
  element: unknown,
  partName: string,
): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${partName} returned no element`);
  }
  if (element.parentNode !== parent) {
    throw new Error(`${partName}'s element is not appended to parent`);
  }
  return element;
}

// A layout's dialog frame must hold its `body` and, exactly when
// `input.hasActions`, its `actions` inside `element`, apart from each other;
// `drawPart` checks `element` itself, so a frame whose `element` is no element
// returns unchecked past the first rule. Throws, in this order:
// `<partName> returned no frame`, `<partName> body is not inside its element`,
// `<partName> drew actions for a dialog with none`,
// `<partName> actions is not inside its element`,
// `<partName> body and actions overlap`.
export function requireDialogFrame(
  frame: unknown,
  input: DialogFrameInput,
  partName: string,
): DialogFramePart {
  if (typeof frame !== 'object' || frame === null) {
    throw new Error(`${partName} returned no frame`);
  }
  const { element, body, actions } = frame as Partial<
    Record<keyof DialogFramePart, unknown>
  >;
  if (!(element instanceof HTMLElement)) {
    return frame as DialogFramePart;
  }
  if (!isInside(element, body)) {
    throw new Error(`${partName} body is not inside its element`);
  }
  if (!input.hasActions) {
    if (actions !== null) {
      throw new Error(`${partName} drew actions for a dialog with none`);
    }
    return { element, body, actions };
  }
  if (!isInside(element, actions)) {
    throw new Error(`${partName} actions is not inside its element`);
  }
  if (body.contains(actions) || actions.contains(body)) {
    throw new Error(`${partName} body and actions overlap`);
  }
  return { element, body, actions };
}

// Whether `node` is an element under `element`, not `element` itself.
function isInside(element: HTMLElement, node: unknown): node is HTMLElement {
  return (
    node instanceof HTMLElement && node !== element && element.contains(node)
  );
}

// One build of `builder` into the parent with a fresh recorder, checked and
// marked with `layoutName` and the owner; rolled back and rethrown on a throw.
// A rollback whose undo throws still undoes the rest and removes what the
// attempt appended; the build's error is rethrown with the undo's appended.
function attempt<L extends object, B, R extends { element: HTMLElement }>(
  options: DrawPartOptions<L, B, R>,
  builder: B,
  layoutName: string,
  drewBundled: boolean,
): DrawnPart<R> {
  const { parent, partName } = options;
  const recorder = createRecorder();
  const existing = new Set(parent.childNodes);
  try {
    const built = options.build(builder, parent, recorder.rollback);
    const element = requireElementIn(
      parent,
      (built as Partial<R> | null | undefined)?.element,
      partName,
    );
    requireOnlyRootAdded(parent, existing, element, partName);
    element.dataset.layout = layoutName;
    element.dataset.layoutOwner = options.owner;
    return { built, layoutName, drewBundled, dispose: recorder.dispose };
  } catch (error) {
    let undoError: unknown = null;
    try {
      recorder.dispose();
    } catch (thrown) {
      undoError = thrown;
    } finally {
      removeAppended(parent, existing);
    }
    if (undoError !== null) {
      throw new Error(
        `${errorText(error)}; rollback failed: ${errorText(undoError)}`,
      );
    }
    throw error;
  }
}

// Throws `<partName> added nodes beside its element` when `parent` holds a
// node `existing` lacks other than `element`.
function requireOnlyRootAdded(
  parent: HTMLElement,
  existing: Set<ChildNode>,
  element: HTMLElement,
  partName: string,
): void {
  const hasStray = Array.from(parent.childNodes).some(
    (node) => node !== element && !existing.has(node),
  );
  if (hasStray) {
    throw new Error(`${partName} added nodes beside its element`);
  }
}

// The recorder one attempt builds with, and the dispose that undoes what it
// recorded, once. The dispose runs every undo even when one throws, then
// throws the first undo's error.
function createRecorder(): { rollback: RollbackDeps; dispose(): void } {
  let boxes: (() => void)[] = [];
  let anchors: Disposable[] = [];
  return {
    rollback: {
      recordBox: (destroy) => boxes.push(destroy),
      recordAnchor: (anchor) => anchors.push(anchor),
    },
    dispose() {
      const undos = [
        ...boxes,
        ...anchors.map((anchor) => () => anchor.dispose()),
      ];
      boxes = [];
      anchors = [];
      callEach(undos, (undo) => undo());
    },
  };
}

// Removes every node of `parent` that `existing` lacks.
function removeAppended(parent: HTMLElement, existing: Set<ChildNode>): void {
  // childNodes is live, so the appended nodes are collected before removal.
  const appended = Array.from(parent.childNodes).filter(
    (node) => !existing.has(node),
  );
  for (const node of appended) {
    node.remove();
  }
}

function logFailureOnce<L extends object>(
  options: Pick<
    DrawPartOptions<L, unknown, { element: HTMLElement }>,
    'pick' | 'partName' | 'log'
  >,
  error: unknown,
): void {
  const { pick, partName } = options;
  const logged = loggedFailures.get(pick.layout) ?? new Set<string>();
  loggedFailures.set(pick.layout, logged);
  if (logged.has(partName)) {
    return;
  }
  logged.add(partName);
  options.log(`layout ${pick.name} ${partName} failed: ${errorText(error)}`);
}
