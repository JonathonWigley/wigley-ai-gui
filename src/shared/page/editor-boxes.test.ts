import { describe, expect, it } from 'vitest';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
  TextEditor,
} from '../../contracts/editor';
import {
  type BoxIdentity,
  createEditorBoxes,
  keepFocusedBox,
} from './editor-boxes';

interface TestBox {
  formId: string;
  key: string;
}

interface FakeEditor extends TextEditor {
  focusCalls: number;
  focusOptions: (FocusOptions | undefined)[];
  blurCalls: number;
  isDestroyed: boolean;
}

// Focus and blur fire their events, as a real editor's DOM focus does.
function fakeHost() {
  const created: { events: EditorEvents; editor: FakeEditor }[] = [];
  const host: EditorHost = {
    create(_parent, doc, events) {
      const editor: FakeEditor = {
        focusCalls: 0,
        focusOptions: [],
        blurCalls: 0,
        isDestroyed: false,
        text: () => doc,
        setText: () => undefined,
        focus: (options) => {
          editor.focusCalls++;
          editor.focusOptions.push(options);
          events.focused();
        },
        blur: () => {
          editor.blurCalls++;
          events.blurred();
        },
        destroy: () => {
          editor.isDestroyed = true;
        },
      };
      created.push({ events, editor });
      return editor;
    },
    createDocument: () => {
      throw new Error('not used by editor boxes');
    },
    contains: () => false,
    typeInto: () => {},
    onPendingKeys: () => {},
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
  return { host, created };
}

const identity: BoxIdentity<TestBox> = {
  formIdOf: (box) => box.formId,
  keyOf: (box) => box.key,
  describe: (box) => box.key,
  logSource: 'test',
};

const parent = {} as HTMLElement;
const notes: TestBox = { formId: 'f1', key: 'f1/notes' };
const reason: TestBox = { formId: 'f1', key: 'f1/reason' };
const other: TestBox = { formId: 'f2', key: 'f2/note' };

// Editor boxes with no box mounted, logging into `logs`.
function emptySetup() {
  const { host, created } = fakeHost();
  const changes: { box: TestBox; text: string }[] = [];
  const activated: TestBox[] = [];
  const logs: string[] = [];
  const boxes = createEditorBoxes(
    host,
    {
      changed: (box, text) => changes.push({ box, text }),
      activated: (box) => activated.push(box),
    },
    (_source, message) => logs.push(message),
    identity,
  );
  return { boxes, created, changes, activated, logs };
}

function setup() {
  const made = emptySetup();
  made.boxes.mount(parent, notes, '');
  made.boxes.mount(parent, reason, '');
  made.boxes.mount(parent, other, '');
  return made;
}

describe('createEditorBoxes', () => {
  it('activates a focused box once, logging it, despite its focus event', () => {
    const { boxes, created, activated, logs } = setup();

    boxes.focus(notes);

    expect(created[0].editor.focusCalls).toBe(1);
    expect(boxes.active()).toEqual(notes);
    expect(activated).toEqual([notes]);
    expect(logs).toEqual(['focused f1/notes']);
  });

  it('hands the focus options to the editor', () => {
    const { boxes, created } = setup();

    boxes.focus(notes, { insertAtEnd: true });

    expect(created[0].editor.focusOptions).toEqual([{ insertAtEnd: true }]);
  });

  it('activates a box whose editor took focus from a click', () => {
    const { boxes, created, activated } = setup();

    created[1].events.focused();

    expect(boxes.active()).toEqual(reason);
    expect(activated).toEqual([reason]);
  });

  it('blurs the focused box on leave and reports no box', () => {
    const { boxes, created } = setup();
    boxes.focus(notes);

    boxes.leave();

    expect(created[0].editor.blurCalls).toBe(1);
    expect(boxes.active()).toBeNull();
    expect(boxes.activeMode()).toBeNull();
  });

  it("reports the focused box's vim mode and tells its listeners", () => {
    const { boxes, created } = setup();
    let calls = 0;
    boxes.onChange(() => calls++);
    boxes.focus(notes);
    const callsAfterFocus = calls;

    created[0].events.modeChanged({ mode: 'visual', subMode: 'linewise' });

    expect(boxes.activeMode()).toEqual({ mode: 'visual', subMode: 'linewise' });
    expect(calls).toBe(callsAfterFocus + 1);
  });

  it('starts every box in normal mode', () => {
    const { boxes } = setup();
    boxes.focus(reason);
    expect(boxes.activeMode()).toEqual({ mode: 'normal', subMode: '' });
  });

  it('forwards a text change with its box', () => {
    const { created, changes } = setup();

    created[1].events.changed('because');

    expect(changes).toEqual([{ box: reason, text: 'because' }]);
  });

  it("finds a box by its editor, and destroys only one form's editors", () => {
    const { boxes, created } = setup();
    boxes.focus(notes);

    boxes.destroyForm('f1');

    expect(created.map((entry) => entry.editor.isDestroyed)).toEqual([
      true,
      true,
      false,
    ]);
    expect(boxes.boxOf(created[0].editor)).toBeUndefined();
    expect(boxes.boxOf(created[2].editor)).toEqual(other);
    expect(boxes.active()).toBeNull();
  });

  it('destroyBox_ThenMountSameBox_Mounts', () => {
    const { boxes, created } = setup();
    boxes.focus(notes);

    boxes.destroyBox(notes);
    boxes.mount(parent, notes, 'again');

    expect(created[0].editor.isDestroyed).toBe(true);
    expect(created[1].editor.isDestroyed).toBe(false);
    expect(boxes.active()).toBeNull();
    expect(boxes.boxOf(created[3].editor)).toEqual(notes);
  });

  it('refuses a box mounted twice, and focusing a box never mounted', () => {
    const { boxes } = setup();
    expect(() => boxes.mount(parent, notes, '')).toThrow(/f1\/notes/);
    expect(() => boxes.focus({ formId: 'f9', key: 'f9/note' })).toThrow(
      /f9\/note/,
    );
  });
});

describe('keepFocusedBox', () => {
  const note: TestBox = { formId: 'f1', key: 'f1/note' };

  function keepSetup() {
    const { boxes, created } = emptySetup();
    // Destroys form f1's boxes and mounts `remounted` again, as a rebuild does.
    const rebuildWith = (remounted: TestBox[]) => () => {
      boxes.destroyForm('f1');
      for (const box of remounted) {
        boxes.mount(parent, box, '');
      }
    };
    return { boxes, created, rebuildWith };
  }

  it('focuses the form box that had focus again after the rebuild', () => {
    const { boxes, created, rebuildWith } = keepSetup();
    boxes.mount(parent, notes, '');
    boxes.mount(parent, note, '');
    boxes.focus(notes);

    keepFocusedBox(boxes, 'f1', rebuildWith([notes, note]));

    expect(boxes.active()).toEqual(notes);
    expect(created[2].editor.focusOptions).toEqual([undefined]);
  });

  it('brings a box in insert mode back in insert mode at its end', () => {
    const { boxes, created, rebuildWith } = keepSetup();
    boxes.mount(parent, notes, '');
    boxes.focus(notes);
    created[0].events.modeChanged({ mode: 'insert', subMode: '' });

    keepFocusedBox(boxes, 'f1', rebuildWith([notes]));

    expect(boxes.active()).toEqual(notes);
    expect(created[1].editor.focusOptions).toEqual([{ insertAtEnd: true }]);
  });

  it('focuses nothing when the rebuilt form no longer mounts the box', () => {
    const { boxes, rebuildWith } = keepSetup();
    boxes.mount(parent, notes, '');
    boxes.focus(notes);

    keepFocusedBox(boxes, 'f1', rebuildWith([note]));

    expect(boxes.active()).toBeNull();
  });

  it("leaves another form's focused box alone", () => {
    const { boxes, created, rebuildWith } = keepSetup();
    boxes.mount(parent, notes, '');
    boxes.mount(parent, other, '');
    boxes.focus(other);

    keepFocusedBox(boxes, 'f1', rebuildWith([notes]));

    expect(boxes.active()).toEqual(other);
    expect(created[2].editor.focusOptions).toEqual([]);
  });
});
