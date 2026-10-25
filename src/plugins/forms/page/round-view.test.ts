import { describe, expect, it } from 'vitest';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
} from '../../../contracts/editor';
import type { BoxRef } from './boxes';
import { createEditorBoxes } from './editor-boxes';
import { keepFocusedBox } from './round-view';

interface CreatedEditor {
  events: EditorEvents;
  focusOptions: (FocusOptions | undefined)[];
}

// Focus fires the editor's focused event, as a real editor's DOM focus does.
function fakeHost() {
  const created: CreatedEditor[] = [];
  const host: EditorHost = {
    create(_parent, doc, events) {
      const editor: CreatedEditor = { events, focusOptions: [] };
      created.push(editor);
      return {
        text: () => doc,
        setText: () => undefined,
        focus: (options) => {
          editor.focusOptions.push(options);
          events.focused();
        },
        blur: () => events.blurred(),
        destroy: () => undefined,
      };
    },
    createDocument: () => {
      throw new Error('not used by forms');
    },
    contains: () => false,
    typeInto: () => {},
    onPendingKeys: () => {},
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
  return { host, created };
}

const parent = {} as HTMLElement;
const notes: BoxRef = {
  roundId: 'r1',
  target: { field: 'notes', item: { kind: 'question', index: 1 } },
};
const note: BoxRef = { roundId: 'r1', target: { field: 'note' } };
const other: BoxRef = { roundId: 'r2', target: { field: 'note' } };

function setup() {
  const { host, created } = fakeHost();
  const boxes = createEditorBoxes(
    host,
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
  );
  // Destroys round r1's boxes and mounts `remounted` again, as a rebuild does.
  const rebuildWith = (remounted: BoxRef[]) => () => {
    boxes.destroyRound('r1');
    for (const box of remounted) {
      boxes.mount(parent, box, '');
    }
  };
  return { boxes, created, rebuildWith };
}

describe('keepFocusedBox', () => {
  it('focuses the round box that had focus again after the rebuild', () => {
    const { boxes, created, rebuildWith } = setup();
    boxes.mount(parent, notes, '');
    boxes.mount(parent, note, '');
    boxes.focus(notes);

    keepFocusedBox(boxes, 'r1', rebuildWith([notes, note]));

    expect(boxes.active()).toEqual(notes);
    expect(created[2].focusOptions).toEqual([undefined]);
  });

  it('brings a box in insert mode back in insert mode at its end', () => {
    const { boxes, created, rebuildWith } = setup();
    boxes.mount(parent, notes, '');
    boxes.focus(notes);
    created[0].events.modeChanged({ mode: 'insert', subMode: '' });

    keepFocusedBox(boxes, 'r1', rebuildWith([notes]));

    expect(boxes.active()).toEqual(notes);
    expect(created[1].focusOptions).toEqual([{ insertAtEnd: true }]);
  });

  it('focuses nothing when the rebuilt round no longer mounts the box', () => {
    const { boxes, rebuildWith } = setup();
    boxes.mount(parent, notes, '');
    boxes.focus(notes);

    keepFocusedBox(boxes, 'r1', rebuildWith([note]));

    expect(boxes.active()).toBeNull();
  });

  it("leaves another round's focused box alone", () => {
    const { boxes, created, rebuildWith } = setup();
    boxes.mount(parent, notes, '');
    boxes.mount(parent, other, '');
    boxes.focus(other);

    keepFocusedBox(boxes, 'r1', rebuildWith([notes]));

    expect(boxes.active()).toEqual(other);
    expect(created[2].focusOptions).toEqual([]);
  });
});
