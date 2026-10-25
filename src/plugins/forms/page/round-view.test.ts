import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
} from '../../../contracts/editor';
import type { Layout } from '../layouts/layout';
import type { BoxRef } from './boxes';
import { createFormsContributions } from './contributions';
import { createEditorBoxes } from './editor-boxes';
import { apply, type FormsState, initialState } from './form-state';
import { asFake, findAll, installFakeDom } from './layout/test-dom';
import { createRoundView, keepFocusedBox } from './round-view';
import { presentedRound } from './test-rounds';

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

// A layout of bare panes and question cards, which leave every box to the
// app.
const bareLayout: Layout = {
  cards: {
    question: (cardParent, _input, kit) => ({
      element: kit.card(cardParent, 'bare'),
    }),
  },
  rail: (paneParent, _input, kit) => ({
    element: kit.el(paneParent, 'div', 'rail'),
  }),
  review: (paneParent, _input, kit) => ({
    element: kit.el(paneParent, 'div', 'review'),
  }),
};

// Round r1, two questions, open and active, shown in the forms view by a round
// view over editor boxes; `main` is the scrolled main column.
function roundViewSetup() {
  const { boxes, created } = setup();
  const presented = presentedRound('r1');
  const state: FormsState = apply(initialState([], presented.sessionId), {
    type: 'roundShown',
    round: presented,
  });
  const round = state.rounds[0];
  const view = createRoundView(
    () => undefined,
    round,
    { layouts: new Map([['default', bareLayout]]), user: 'default' },
    {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
      },
      boxes,
      keys: {
        keysFor: () => null,
        onChanged: () => ({ dispose: () => undefined }),
      },
      dispatch: vi.fn(),
      getState: () => state,
      run: vi.fn(),
      commands: { exists: () => false, run: vi.fn() },
      contributions: createFormsContributions(),
      platform: 'macos',
      uiState: { get: () => undefined, set: () => undefined },
      log: vi.fn(),
    },
  );
  view.update(round, 'forms');
  const [main] = findAll(asFake(view.element), 'ui-split-end');
  return { boxes, created, round, view, main };
}

describe('round view rebuild', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the main column scroll while the round shows the same item', () => {
    const { round, view, main } = roundViewSetup();
    main.scrollTop = 120;

    view.rebuild(round);

    expect(main.scrollTop).toBe(120);
  });

  it('scrolls the main column to the top when the shown item changed', () => {
    const { round, view, main } = roundViewSetup();
    main.scrollTop = 120;

    view.rebuild({ ...round, focus: round.focus + 1 });

    expect(main.scrollTop).toBe(0);
  });

  it('focuses the box that had focus again in the rebuilt round', () => {
    const { boxes, created, round, view } = roundViewSetup();
    const questionNotes: BoxRef = {
      roundId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 1 } },
    };
    boxes.focus(questionNotes);
    const builtBefore = created.length;

    view.rebuild(round);

    expect(boxes.active()).toEqual(questionNotes);
    const focusedAfter = created
      .slice(builtBefore)
      .filter((editor) => editor.focusOptions.length > 0);
    expect(focusedAfter).toHaveLength(1);
  });
});
