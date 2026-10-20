import type {
  EditorHost,
  FocusOptions,
  TextEditor,
  VimMode,
} from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import { type BoxRef, boxDescription, boxKey } from './boxes';

export interface EditorBoxEvents {
  changed(box: BoxRef, text: string): void;
  // A box took focus, from a command or a click.
  activated(box: BoxRef): void;
}

// One editor per text box, created once when its round first renders.
export interface EditorBoxes {
  mount(parent: HTMLElement, box: BoxRef, text: string): void;
  boxOf(editor: TextEditor): BoxRef | undefined;
  // Focuses the box's editor; the box counts as focused at once.
  focus(box: BoxRef, options?: FocusOptions): void;
  // Blurs the focused box, if any.
  leave(): void;
  active(): BoxRef | null;
  // The focused box's vim mode, or null outside every box.
  activeMode(): VimMode | null;
  // Destroys one mounted box's editor, so the box can mount again.
  destroyBox(box: BoxRef): void;
  destroyRound(roundId: string): void;
  // Runs after the focused box, or its vim mode, changes.
  onChange(listener: () => void): void;
}

interface MountedBox {
  box: BoxRef;
  editor: TextEditor;
}

const STARTING_MODE: VimMode = { mode: 'normal', subMode: '' };

export function createEditorBoxes(
  host: EditorHost,
  events: EditorBoxEvents,
  log: Log,
): EditorBoxes {
  const mounted = new Map<string, MountedBox>();
  const modes = new Map<string, VimMode>();
  const listeners: (() => void)[] = [];
  let activeKey: string | null = null;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  // A command's focus and the editor's own focus event both land here.
  const activate = (key: string, box: BoxRef) => {
    if (activeKey === key) {
      return;
    }
    activeKey = key;
    log('forms', `focused ${boxDescription(box)}`);
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
  const destroy = (key: string, entry: MountedBox) => {
    if (activeKey === key) {
      activeKey = null;
    }
    entry.editor.destroy();
    mounted.delete(key);
    modes.delete(key);
  };

  return {
    mount(parent, box, text) {
      const key = boxKey(box);
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
    boxOf(editor) {
      return [...mounted.values()].find((entry) => entry.editor === editor)
        ?.box;
    },
    focus(box, options) {
      const key = boxKey(box);
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
      const key = boxKey(box);
      const entry = mounted.get(key);
      if (entry === undefined) {
        throw new Error(`No box is mounted as ${key}`);
      }
      destroy(key, entry);
      notify();
    },
    destroyRound(roundId) {
      for (const [key, entry] of mounted) {
        if (entry.box.roundId === roundId) {
          destroy(key, entry);
        }
      }
      notify();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
