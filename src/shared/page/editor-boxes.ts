import {
  type DroppedFile,
  type DropTarget,
  NOTHING_TAKES_FILES,
} from '../../contracts/drops';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
  TextEditor,
  VimMode,
} from '../../contracts/editor';
import type { PluginLog } from '../../contracts/log';
import type { ToastTone } from '../../contracts/plugin';
import { insertionText } from './file-drop/file-chips';
import { pathOf } from './file-drop/file-path';
import { inputFrame } from './ui/input-frame';

// How the boxes of one kind of form are told apart.
export interface BoxIdentity<Box> {
  // The form a box belongs to; `destroyForm` drops a form's boxes together.
  formIdOf(box: Box): string;
  // Unique among every placed box.
  keyOf(box: Box): string;
  // How the log names the box, e.g. `notes on question 1`.
  describe(box: Box): string;
}

export interface EditorBoxEvents<Box> {
  changed(box: Box, text: string): void;
  // A box took focus, from a command or a click.
  activated(box: Box): void;
}

// One editor per text box, created the first time its form places it and kept
// across redraws until its form or the box is destroyed.
export interface EditorBoxes<Box> {
  // Appends the box's frame, a `div.ui-input` holding its editor, to `parent`
  // and returns it. The first call makes the frame and the editor; a later
  // call, placed or released, moves the same frame, keeping the editor's
  // cursor, vim mode, undo and scroll, and sets its text when `text` differs
  // from it (no `changed`).
  place(parent: HTMLElement, box: Box, text: string): HTMLElement;
  // Sets the placed box's editor text when `text` differs from it (no
  // `changed`), leaving its frame, scroll and focus where they are. Does
  // nothing for a box that is not placed.
  setText(box: Box, text: string): void;
  // Detaches the box's frame and keeps its editor, and blurs it when focused.
  // Does nothing for a box already released or held by no editor.
  release(box: Box): void;
  // Destroys every released box of form `formId`: the boxes a redraw
  // released and did not place again.
  destroyReleased(formId: string): void;
  // Whether the box is placed; false once released or destroyed.
  isPlaced(box: Box): boolean;
  // Undefined for a released box's editor.
  boxOf(editor: TextEditor): Box | undefined;
  // The box's editor while it is placed, else undefined.
  editorOf(box: Box): TextEditor | undefined;
  // Focuses the box's editor; the box counts as focused at once. Throws for a
  // box released or never placed.
  focus(box: Box, options?: FocusOptions): void;
  // Blurs the focused box, if any.
  leave(): void;
  active(): Box | null;
  // The focused box's vim mode, or null outside every box.
  activeMode(): VimMode | null;
  // Destroys one box's editor and removes its frame, so the box can be
  // placed anew; does nothing for a box no editor holds.
  destroyBox(box: Box): void;
  destroyForm(formId: string): void;
  // The editor files dropped on form `formId` go into: its box activated last
  // while that box is placed and `isShown`, else its placed, shown box whose
  // editor was created first; null when the form shows none. Both records outlive
  // `release`, `destroyBox` and `destroyForm`, so a rebuilt form keeps them.
  fileEditor(formId: string, isShown: (box: Box) => boolean): TextEditor | null;
  // Drops the form's last-activated box and its boxes' first-mount order.
  forgetForm(formId: string): void;
  formIdOf(box: Box): string;
  // Runs after the focused box, or its vim mode, changes.
  onChange(listener: () => void): void;
}

// A box whose editor lives. `order` is the box's first-mount order; `frame`
// is the `div.ui-input` holding its editor; `scrollTop` is the editor
// scroller's scroll when the box was last released or moved, null when it had
// no scroller.
interface HeldBox<Box> {
  box: Box;
  editor: TextEditor;
  order: number;
  frame: HTMLElement;
  isPlaced: boolean;
  scrollTop: number | null;
}

// When a box first mounted, kept across its remounts.
interface FirstMount {
  formId: string;
  order: number;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

export function createEditorBoxes<Box>(
  host: EditorHost,
  events: EditorBoxEvents<Box>,
  log: PluginLog,
  identity: BoxIdentity<Box>,
): EditorBoxes<Box> {
  const held = new Map<string, HeldBox<Box>>();
  const modes = new Map<string, VimMode>();
  const listeners: (() => void)[] = [];
  let activeKey: string | null = null;
  // Each form's box activated last, by key.
  const lastActivated = new Map<string, string>();
  const firstMounts = new Map<string, FirstMount>();
  let mountCount = 0;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  // A command's focus and the editor's own focus event both land here.
  const activate = (key: string, box: Box) => {
    if (activeKey === key) {
      return;
    }
    activeKey = key;
    lastActivated.set(identity.formIdOf(box), key);
    log(`focused ${identity.describe(box)}`);
    events.activated(box);
    notify();
  };
  const deactivate = (key: string) => {
    if (activeKey !== key) {
      return;
    }
    activeKey = null;
    notify();
  };
  const destroy = (key: string, entry: HeldBox<Box>) => {
    if (activeKey === key) {
      activeKey = null;
    }
    entry.editor.destroy();
    entry.frame.remove();
    held.delete(key);
    modes.delete(key);
  };
  const placedEntry = (key: string) => {
    const entry = held.get(key);
    return entry?.isPlaced === true ? entry : undefined;
  };
  // Creates the box's editor in `frame` and records its first mount.
  const create = (frame: HTMLElement, key: string, box: Box, text: string) => {
    const editorEvents: EditorEvents = {
      changed: (value) => events.changed(box, value),
      focused: () => activate(key, box),
      blurred: () => deactivate(key),
      modeChanged: (mode) => {
        modes.set(key, mode);
        if (activeKey === key) {
          notify();
        }
      },
    };
    const editor = host.create(frame, text, editorEvents);
    const firstMount = firstMounts.get(key) ?? {
      formId: identity.formIdOf(box),
      order: mountCount++,
    };
    firstMounts.set(key, firstMount);
    held.set(key, {
      box,
      editor,
      order: firstMount.order,
      frame,
      isPlaced: true,
      scrollTop: null,
    });
  };
  return {
    place(parent, box, text) {
      const key = identity.keyOf(box);
      const entry = held.get(key);
      if (entry === undefined) {
        const frame = inputFrame();
        parent.append(frame);
        create(frame, key, box, text);
        return frame;
      }
      const { frame } = entry;
      const scroller = frame.querySelector<HTMLElement>('.cm-scroller');
      if (entry.isPlaced) {
        entry.scrollTop = scroller?.scrollTop ?? null;
      }
      parent.append(frame);
      entry.isPlaced = true;
      setTextIfChanged(entry.editor, text);
      if (scroller !== null && entry.scrollTop !== null) {
        scroller.scrollTop = entry.scrollTop;
      }
      return frame;
    },
    setText(box, text) {
      const entry = placedEntry(identity.keyOf(box));
      if (entry !== undefined) {
        setTextIfChanged(entry.editor, text);
      }
    },
    release(box) {
      const key = identity.keyOf(box);
      const entry = held.get(key);
      if (entry === undefined || !entry.isPlaced) {
        return;
      }
      const { frame } = entry;
      entry.scrollTop =
        frame.querySelector<HTMLElement>('.cm-scroller')?.scrollTop ?? null;
      entry.isPlaced = false;
      // Cleared ahead of the detach, so a blur the detach fires finds no
      // active box and the listeners hear one change.
      const wasActive = activeKey === key;
      if (wasActive) {
        activeKey = null;
      }
      frame.remove();
      if (wasActive) {
        notify();
      }
    },
    destroyReleased(formId) {
      for (const [key, entry] of held) {
        if (!entry.isPlaced && identity.formIdOf(entry.box) === formId) {
          destroy(key, entry);
        }
      }
      notify();
    },
    isPlaced(box) {
      return placedEntry(identity.keyOf(box)) !== undefined;
    },
    boxOf(editor) {
      return [...held.values()].find(
        (entry) => entry.isPlaced && entry.editor === editor,
      )?.box;
    },
    editorOf(box) {
      return placedEntry(identity.keyOf(box))?.editor;
    },
    focus(box, options) {
      const key = identity.keyOf(box);
      const entry = placedEntry(key);
      if (entry === undefined) {
        throw new Error(`No box is placed as ${key}`);
      }
      entry.editor.focus(options);
      activate(key, box);
    },
    leave() {
      if (activeKey === null) {
        return;
      }
      const entry = held.get(activeKey);
      activeKey = null;
      entry?.editor.blur();
      notify();
    },
    active() {
      return activeKey === null ? null : (held.get(activeKey)?.box ?? null);
    },
    activeMode() {
      return activeKey === null
        ? null
        : (modes.get(activeKey) ?? STARTING_MODE);
    },
    destroyBox(box) {
      const key = identity.keyOf(box);
      const entry = held.get(key);
      if (entry === undefined) {
        return;
      }
      destroy(key, entry);
      notify();
    },
    destroyForm(formId) {
      for (const [key, entry] of held) {
        if (identity.formIdOf(entry.box) === formId) {
          destroy(key, entry);
        }
      }
      notify();
    },
    fileEditor(formId, isShown) {
      const lastKey = lastActivated.get(formId);
      const last = lastKey === undefined ? undefined : placedEntry(lastKey);
      if (last !== undefined && isShown(last.box)) {
        return last.editor;
      }
      const [first] = [...held.values()]
        .filter(
          (entry) =>
            entry.isPlaced &&
            identity.formIdOf(entry.box) === formId &&
            isShown(entry.box),
        )
        .sort((a, b) => a.order - b.order);
      return first?.editor ?? null;
    },
    forgetForm(formId) {
      lastActivated.delete(formId);
      for (const [key, firstMount] of firstMounts) {
        if (firstMount.formId === formId) {
          firstMounts.delete(key);
        }
      }
    },
    formIdOf(box) {
      return identity.formIdOf(box);
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

function setTextIfChanged(editor: TextEditor, text: string): void {
  if (text !== editor.text()) {
    editor.setText(text);
  }
}

// Runs `rebuild`, which releases and places again the boxes of form `formId`,
// destroys the form's boxes it left released, then focuses the form's box
// that had focus before it again, when the rebuilt form places it. A kept box
// keeps its cursor, vim mode and undo; a box in insert mode comes back in
// insert mode, at its cursor when kept and at its text's end when made anew.
export function keepFocusedBox<Box>(
  boxes: Pick<
    EditorBoxes<Box>,
    | 'active'
    | 'activeMode'
    | 'focus'
    | 'isPlaced'
    | 'editorOf'
    | 'formIdOf'
    | 'destroyReleased'
  >,
  formId: string,
  rebuild: () => void,
): void {
  const active = boxes.active();
  const focused =
    active !== null && boxes.formIdOf(active) === formId ? active : null;
  const wasInserting = boxes.activeMode()?.mode === 'insert';
  const editorBefore = focused === null ? undefined : boxes.editorOf(focused);
  rebuild();
  boxes.destroyReleased(formId);
  if (focused === null || !boxes.isPlaced(focused)) {
    return;
  }
  const isKept = boxes.editorOf(focused) === editorBefore;
  const inserting: FocusOptions = isKept
    ? { insert: true }
    : { insertAtEnd: true };
  boxes.focus(focused, wasInserting ? inserting : undefined);
}

// The box `step` places away from `from` in `shown`, clamped at the ends;
// with no `from`, or one not in `shown`, the first box; null for an empty
// `shown`.
export function stepBox<Box>(
  shown: readonly Box[],
  keyOf: (box: Box) => string,
  from: Box | null,
  step: number,
): Box | null {
  const position = from === null ? -1 : shown.map(keyOf).indexOf(keyOf(from));
  if (position < 0) {
    return shown[0] ?? null;
  }
  return shown[Math.min(Math.max(position + step, 0), shown.length - 1)];
}

export interface BoxDropDeps {
  savePasted(file: DroppedFile): Promise<string>;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
}

// A drop target's `take` that types every file's path, as file chips, into
// the editor `editorFor` names, saving a file with no path first. With no
// editor it toasts `NOTHING_TAKES_FILES` and saves nothing; a file that fails
// to save is toasted and left out. An editor gone once the saves land gets
// nothing, and the saved paths go to the log.
export function boxDropTake(
  editorFor: () => TextEditor | null,
  deps: BoxDropDeps,
): DropTarget['take'] {
  return (files) => {
    void takeFiles(files, editorFor, deps);
  };
}

async function takeFiles(
  files: readonly DroppedFile[],
  editorFor: () => TextEditor | null,
  deps: BoxDropDeps,
): Promise<void> {
  const { log } = deps;
  if (editorFor() === null) {
    deps.toast(NOTHING_TAKES_FILES, 'info');
    log(`${String(files.length)} files dropped where no box takes them`);
    return;
  }
  const saveFailed = (file: DroppedFile, error: string) => {
    const message = `${file.name} not saved: ${error}`;
    deps.toast(message, 'error');
    log(message);
  };
  const paths: string[] = [];
  for (const file of files) {
    const path = await pathOf(file, deps.savePasted, saveFailed);
    if (path !== null) {
      paths.push(path);
    }
  }
  if (paths.length === 0) {
    return;
  }
  const editor = editorFor();
  if (editor === null) {
    log(`no box left for the dropped files: ${paths.join(' ')}`);
    return;
  }
  editor.insert(insertionText(paths, editor.charBeforeCursor()));
}
