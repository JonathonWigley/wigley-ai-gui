import type {
  EditorHost,
  FocusOptions,
  TextEditor,
  VimMode,
} from '../../contracts/editor';
import type { Log } from '../../contracts/log';

// How the boxes of one kind of form are told apart.
export interface BoxIdentity<Box> {
  // The form a box belongs to; `destroyForm` drops a form's boxes together.
  formIdOf(box: Box): string;
  // Unique among every mounted box.
  keyOf(box: Box): string;
  // How the log names the box, e.g. `notes on question 1`.
  describe(box: Box): string;
  // The log line's source, the plugin id.
  logSource: string;
}

export interface EditorBoxEvents<Box> {
  changed(box: Box, text: string): void;
  // A box took focus, from a command or a click.
  activated(box: Box): void;
}

// One editor per text box, created once when its form first renders.
export interface EditorBoxes<Box> {
  mount(parent: HTMLElement, box: Box, text: string): void;
  isMounted(box: Box): boolean;
  boxOf(editor: TextEditor): Box | undefined;
  // Focuses the box's editor; the box counts as focused at once.
  focus(box: Box, options?: FocusOptions): void;
  // Blurs the focused box, if any.
  leave(): void;
  active(): Box | null;
  // The focused box's vim mode, or null outside every box.
  activeMode(): VimMode | null;
  // Destroys one mounted box's editor, so the box can mount again.
  destroyBox(box: Box): void;
  destroyForm(formId: string): void;
  formIdOf(box: Box): string;
  // Runs after the focused box, or its vim mode, changes.
  onChange(listener: () => void): void;
}

interface MountedBox<Box> {
  box: Box;
  editor: TextEditor;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

export function createEditorBoxes<Box>(
  host: EditorHost,
  events: EditorBoxEvents<Box>,
  log: Log,
  identity: BoxIdentity<Box>,
): EditorBoxes<Box> {
  const mounted = new Map<string, MountedBox<Box>>();
  const modes = new Map<string, VimMode>();
  const listeners: (() => void)[] = [];
  let activeKey: string | null = null;

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
    log(identity.logSource, `focused ${identity.describe(box)}`);
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
  const destroy = (key: string, entry: MountedBox<Box>) => {
    if (activeKey === key) {
      activeKey = null;
    }
    entry.editor.destroy();
    mounted.delete(key);
    modes.delete(key);
  };

  return {
    mount(parent, box, text) {
      const key = identity.keyOf(box);
      if (mounted.has(key)) {
        throw new Error(`Box ${key} is already mounted`);
      }
      const editor = host.create(parent, text, {
        changed: (value) => events.changed(box, value),
        focused: () => activate(key, box),
        blurred: () => deactivate(key),
        modeChanged: (mode) => {
          modes.set(key, mode);
          if (activeKey === key) {
            notify();
          }
        },
      });
      mounted.set(key, { box, editor });
    },
    isMounted(box) {
      return mounted.has(identity.keyOf(box));
    },
    boxOf(editor) {
      return [...mounted.values()].find((entry) => entry.editor === editor)
        ?.box;
    },
    focus(box, options) {
      const key = identity.keyOf(box);
      const entry = mounted.get(key);
      if (entry === undefined) {
        throw new Error(`No box is mounted as ${key}`);
      }
      entry.editor.focus(options);
      activate(key, box);
    },
    leave() {
      if (activeKey === null) {
        return;
      }
      const entry = mounted.get(activeKey);
      activeKey = null;
      entry?.editor.blur();
      notify();
    },
    active() {
      return activeKey === null ? null : (mounted.get(activeKey)?.box ?? null);
    },
    activeMode() {
      return activeKey === null
        ? null
        : (modes.get(activeKey) ?? STARTING_MODE);
    },
    destroyBox(box) {
      const key = identity.keyOf(box);
      const entry = mounted.get(key);
      if (entry === undefined) {
        throw new Error(`No box is mounted as ${key}`);
      }
      destroy(key, entry);
      notify();
    },
    destroyForm(formId) {
      for (const [key, entry] of mounted) {
        if (identity.formIdOf(entry.box) === formId) {
          destroy(key, entry);
        }
      }
      notify();
    },
    formIdOf(box) {
      return identity.formIdOf(box);
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

// Runs `rebuild`, which destroys and remounts the boxes of form `formId`,
// then focuses the form's box that had focus before it again, when the
// rebuilt form still mounts it. A box in insert mode comes back in insert
// mode at its text's end; the cursor, any other vim mode and undo are lost.
export function keepFocusedBox<Box>(
  boxes: Pick<
    EditorBoxes<Box>,
    'active' | 'activeMode' | 'focus' | 'isMounted' | 'formIdOf'
  >,
  formId: string,
  rebuild: () => void,
): void {
  const active = boxes.active();
  const focused =
    active !== null && boxes.formIdOf(active) === formId ? active : null;
  const wasInserting = boxes.activeMode()?.mode === 'insert';
  rebuild();
  if (focused === null || !boxes.isMounted(focused)) {
    return;
  }
  boxes.focus(focused, wasInserting ? { insertAtEnd: true } : undefined);
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
