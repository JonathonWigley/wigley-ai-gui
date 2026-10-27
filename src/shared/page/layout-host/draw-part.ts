import type { Disposable } from '../../../contracts/disposable';
import type { LayoutOwner } from '../../../contracts/layouts';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../error-text';

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
  log: Log;
  logSource: string;
  partName: string;
}

// A drawn part: the owner's built object, the layout that drew it, and the
// dispose of every anchor and box its build recorded.
export interface DrawnPart<R> {
  built: R;
  layoutName: string;
  dispose(): void;
}

const DEFAULT_NAME = 'default';

// The part names whose failure was logged, by the layout object that failed.
// The loader makes a new layout object for each revision, so a new revision
// logs again.
const loggedFailures = new WeakMap<object, Set<string>>();

// Draws the part with the picked layout when it defines the part, else with
// `default`. Each attempt builds with a fresh recorder and must return an
// element appended to `parent`. When the picked attempt throws, it is rolled
// back (each recorded box destroyed, each recorded anchor disposed, each node
// it appended to `parent` removed), `layout <name> <partName> failed: <error>`
// is logged under `logSource` once per layout object and part name, and
// `default` draws in its place. A throw from the `default` attempt rolls back
// the same way and is rethrown, with no log. Throws
// `layout default has no <partName>` when `default` must draw a part it lacks.
// `built.element` carries `data-layout="<layoutName>"` and
// `data-layout-owner="<owner>"`. `dispose` disposes every anchor and runs every
// box destroy the drawing attempt recorded, once; a second call does nothing.
// It does not remove `built.element`.
export function drawPart<
  L extends object,
  B,
  R extends { element: HTMLElement },
>(options: DrawPartOptions<L, B, R>): DrawnPart<R> {
  const { pick } = options;
  const picked = options.part(pick.layout);
  if (picked !== undefined && pick.name !== DEFAULT_NAME) {
    try {
      return attempt(options, picked, pick.name);
    } catch (error) {
      logFailureOnce(options, error);
    }
  }
  const builder = options.part(options.defaultLayout);
  if (builder === undefined) {
    throw new Error(`layout ${DEFAULT_NAME} has no ${options.partName}`);
  }
  return attempt(options, builder, DEFAULT_NAME);
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

// One build of `builder` into the parent with a fresh recorder, checked and
// marked with `layoutName` and the owner; rolled back and rethrown on a throw.
function attempt<L extends object, B, R extends { element: HTMLElement }>(
  options: DrawPartOptions<L, B, R>,
  builder: B,
  layoutName: string,
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
    element.dataset.layout = layoutName;
    element.dataset.layoutOwner = options.owner;
    return { built, layoutName, dispose: recorder.dispose };
  } catch (error) {
    recorder.dispose();
    removeAppended(parent, existing);
    throw error;
  }
}

// The recorder one attempt builds with, and the dispose that undoes what it
// recorded, once.
function createRecorder(): { rollback: RollbackDeps; dispose(): void } {
  let boxes: (() => void)[] = [];
  let anchors: Disposable[] = [];
  return {
    rollback: {
      recordBox: (destroy) => boxes.push(destroy),
      recordAnchor: (anchor) => anchors.push(anchor),
    },
    dispose() {
      const [destroys, disposables] = [boxes, anchors];
      boxes = [];
      anchors = [];
      for (const destroy of destroys) {
        destroy();
      }
      for (const anchor of disposables) {
        anchor.dispose();
      }
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
    'pick' | 'partName' | 'log' | 'logSource'
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
  options.log(
    options.logSource,
    `layout ${pick.name} ${partName} failed: ${errorText(error)}`,
  );
}
