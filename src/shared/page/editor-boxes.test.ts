import { describe, expect, it } from 'vitest';
import { type DroppedFile, NOTHING_TAKES_FILES } from '../../contracts/drops';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
  TextEditor,
} from '../../contracts/editor';
import {
  type BoxIdentity,
  boxDropTake,
  createEditorBoxes,
  keepFocusedBox,
} from './editor-boxes';
import { insertionText } from './file-drop/file-chips';

interface TestBox {
  formId: string;
  key: string;
}

interface FakeEditor extends TextEditor {
  focusCalls: number;
  focusOptions: (FocusOptions | undefined)[];
  blurCalls: number;
  isDestroyed: boolean;
  inserts: string[];
}

// Focus and blur fire their events, as a real editor's DOM focus does; every
// cursor sits after an `x`.
function fakeHost() {
  const created: { events: EditorEvents; editor: FakeEditor }[] = [];
  const host: EditorHost = {
    create(_parent, doc, events) {
      const editor: FakeEditor = {
        focusCalls: 0,
        focusOptions: [],
        blurCalls: 0,
        isDestroyed: false,
        inserts: [],
        text: () => doc,
        setText: () => undefined,
        insert: (text) => {
          editor.inserts.push(text);
        },
        charBeforeCursor: () => 'x',
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
    onPendingKeys: () => ({ dispose: () => {} }),
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
  return { host, created };
}

const identity: BoxIdentity<TestBox> = {
  formIdOf: (box) => box.formId,
  keyOf: (box) => box.key,
  describe: (box) => box.key,
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
    (message: string) => logs.push(message),
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

describe('fileEditor', () => {
  it.each<{
    steps: string;
    act: (made: ReturnType<typeof setup>) => void;
    hidden?: TestBox[];
    expected: TestBox | null;
  }>([
    { steps: 'none', act: () => undefined, expected: notes },
    {
      steps: 'focus reason, then leave',
      act: ({ boxes }) => {
        boxes.focus(reason);
        boxes.leave();
      },
      expected: reason,
    },
    {
      steps: 'focus reason, destroyBox(reason)',
      act: ({ boxes }) => {
        boxes.focus(reason);
        boxes.destroyBox(reason);
      },
      expected: notes,
    },
    {
      steps: "focus reason, destroyForm('f1'), mount reason then notes again",
      act: ({ boxes }) => {
        boxes.focus(reason);
        boxes.destroyForm('f1');
        boxes.mount(parent, reason, '');
        boxes.mount(parent, notes, '');
      },
      expected: reason,
    },
    {
      steps: 'destroyBox(notes), mount notes again (first-mount order kept)',
      act: ({ boxes }) => {
        boxes.destroyBox(notes);
        boxes.mount(parent, notes, '');
      },
      expected: notes,
    },
    {
      steps:
        "nothing focused, destroyForm('f1'), mount reason then notes again (order survives destroyForm)",
      act: ({ boxes }) => {
        boxes.destroyForm('f1');
        boxes.mount(parent, reason, '');
        boxes.mount(parent, notes, '');
      },
      expected: notes,
    },
    {
      steps:
        "focus reason, destroyForm('f1'), forgetForm('f1'), mount reason then notes again (order and last-used reset)",
      act: ({ boxes }) => {
        boxes.focus(reason);
        boxes.destroyForm('f1');
        boxes.forgetForm('f1');
        boxes.mount(parent, reason, '');
        boxes.mount(parent, notes, '');
      },
      expected: reason,
    },
    {
      steps: 'focus reason, leave, reason hidden',
      act: ({ boxes }) => {
        boxes.focus(reason);
        boxes.leave();
      },
      hidden: [reason],
      expected: notes,
    },
    {
      steps: 'nothing focused, notes hidden',
      act: () => undefined,
      hidden: [notes],
      expected: reason,
    },
    {
      steps: 'notes and reason hidden',
      act: () => undefined,
      hidden: [notes, reason],
      expected: null,
    },
    {
      steps: 'focus other',
      act: ({ boxes }) => boxes.focus(other),
      expected: notes,
    },
    {
      steps: "destroyForm('f1')",
      act: ({ boxes }) => boxes.destroyForm('f1'),
      expected: null,
    },
  ])(
    'fileEditor_PicksLastUsedElseFirst: $steps',
    ({ act, hidden = [], expected }) => {
      const made = setup();
      act(made);
      const isShown = (box: TestBox) =>
        !hidden.some((hiddenBox) => hiddenBox.key === box.key);

      const editor = made.boxes.fileEditor('f1', isShown);

      const expectedEditor =
        expected === null
          ? null
          : made.created.find(
              (entry) =>
                !entry.editor.isDestroyed &&
                made.boxes.boxOf(entry.editor) === expected,
            )?.editor;
      expect(editor).toBe(expectedEditor);
    },
  );
});

describe('boxDropTake', () => {
  const SAVED = '/app/pasted/20261102-090000-1.png';

  function droppedFile(name: string, path: string): DroppedFile {
    return {
      name,
      mediaType: '',
      path,
      bytes: async () => new Uint8Array(),
    };
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // `editors` answers `editorFor` in turn, its last answer from then on:
  // true for the box's editor, false for none.
  it.each<{
    name: string;
    editors: boolean[];
    files: DroppedFile[];
    inserts: string[];
    toasts: [string, string][];
    logs?: string[];
  }>([
    {
      name: 'no editor',
      editors: [false],
      files: [droppedFile('image.png', '')],
      inserts: [],
      toasts: [[NOTHING_TAKES_FILES, 'info']],
    },
    {
      name: 'an editor gone once the saves land',
      editors: [true, false],
      files: [droppedFile('image.png', ''), droppedFile('a.md', '/d/a.md')],
      inserts: [],
      toasts: [],
      logs: [`no box left for the dropped files: ${SAVED} /d/a.md`],
    },
    {
      name: 'two files on disk',
      editors: [true],
      files: [
        droppedFile('a.md', '/d/a.md'),
        droppedFile('My File.mp4', '/d/My File.mp4'),
      ],
      inserts: [insertionText(['/d/a.md', '/d/My File.mp4'], 'x')],
      toasts: [],
    },
    {
      name: 'a pasted file',
      editors: [true],
      files: [droppedFile('image.png', '')],
      inserts: [insertionText([SAVED], 'x')],
      toasts: [],
    },
    {
      name: 'a failed save beside a file on disk',
      editors: [true],
      files: [droppedFile('bad.png', ''), droppedFile('a.md', '/d/a.md')],
      inserts: [insertionText(['/d/a.md'], 'x')],
      toasts: [['bad.png not saved: disk full', 'error']],
    },
    {
      name: 'a failed save alone',
      editors: [true],
      files: [droppedFile('bad.png', '')],
      inserts: [],
      toasts: [['bad.png not saved: disk full', 'error']],
    },
  ])(
    'boxDropTake_TakesFilesIntoTheBox: $name',
    async ({ editors, files, inserts, toasts, logs }) => {
      const { created } = setup();
      const editor = created[0].editor;
      const saved: string[] = [];
      const shownToasts: [string, string][] = [];
      const logged: string[] = [];
      let calls = 0;
      const editorFor = () => {
        const hasEditor = editors[Math.min(calls, editors.length - 1)];
        calls++;
        return hasEditor ? editor : null;
      };
      const take = boxDropTake(editorFor, {
        savePasted: async (file) => {
          saved.push(file.name);
          if (file.name === 'bad.png') {
            throw new Error('disk full');
          }
          return SAVED;
        },
        toast: (text, tone) => shownToasts.push([text, tone]),
        log: (message: string) => logged.push(message),
      });

      take(files);
      await settle();

      expect(editor.inserts).toEqual(inserts);
      expect(shownToasts).toEqual(toasts);
      if (!editors[0]) {
        expect(saved).toEqual([]);
      }
      if (logs !== undefined) {
        expect(logged).toEqual(logs);
      }
    },
  );
});
