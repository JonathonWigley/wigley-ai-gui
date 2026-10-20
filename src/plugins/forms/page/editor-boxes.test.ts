import { describe, expect, it } from 'vitest';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
  TextEditor,
} from '../../../contracts/editor';
import type { BoxRef } from './boxes';
import { createEditorBoxes } from './editor-boxes';

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
    contains: () => false,
    typeInto: () => {},
    onPendingKeys: () => {},
    cancelPendingKeys: () => {},
  };
  return { host, created };
}

const parent = {} as HTMLElement;
const notes: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'question', index: 1 } },
};
const reason: BoxRef = {
  roundId: 'r1',
  target: { field: 'dontAskReason', item: { kind: 'question', index: 1 } },
};
const other: BoxRef = { roundId: 'r2', target: { field: 'note' } };

function setup() {
  const { host, created } = fakeHost();
  const changes: { box: BoxRef; text: string }[] = [];
  const activated: BoxRef[] = [];
  const logs: string[] = [];
  const boxes = createEditorBoxes(
    host,
    {
      changed: (box, text) => changes.push({ box, text }),
      activated: (box) => activated.push(box),
    },
    (_source, message) => logs.push(message),
  );
  boxes.mount(parent, notes, '');
  boxes.mount(parent, reason, '');
  boxes.mount(parent, other, '');
  return { boxes, created, changes, activated, logs };
}

describe('createEditorBoxes', () => {
  it('activates a focused box once, logging it, despite its focus event', () => {
    const { boxes, created, activated, logs } = setup();

    boxes.focus(notes);

    expect(created[0].editor.focusCalls).toBe(1);
    expect(boxes.active()).toEqual(notes);
    expect(activated).toEqual([notes]);
    expect(logs).toEqual(['focused notes on question 1']);
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

  it("finds a box by its editor, and destroys only one round's editors", () => {
    const { boxes, created } = setup();
    boxes.focus(notes);

    boxes.destroyRound('r1');

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
    expect(() => boxes.mount(parent, notes, '')).toThrow(
      /r1\/notes\/question\/1/,
    );
    expect(() =>
      boxes.focus({ roundId: 'r9', target: { field: 'note' } }),
    ).toThrow(/r9\/note/);
  });
});
