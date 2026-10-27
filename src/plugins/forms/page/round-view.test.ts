import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
} from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import type { Layout } from '../layouts/layout';
import { type BoxRef, FORMS_BOX_IDENTITY } from './boxes';
import { createFormsContributions } from './contributions';
import { apply, type FormsState, initialState } from './form-state';
import { asFake, findAll, installFakeDom } from '../../../shared/page/test-dom';
import { createRoundView } from './round-view';
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

function setup() {
  const { host, created } = fakeHost();
  const boxes = createEditorBoxes(
    host,
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
    FORMS_BOX_IDENTITY,
  );
  return { boxes, created };
}

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
// view over editor boxes; `main` is the scrolled main column, and `anchors`
// holds every Disposable the keys' `anchor` returned, in call order.
function roundViewSetup() {
  const { boxes, created } = setup();
  const anchors: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const presented = presentedRound('r1');
  const state: FormsState = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
  const round = state.forms[0];
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
        anchor: () => {
          const anchor = { dispose: vi.fn() };
          anchors.push(anchor);
          return anchor;
        },
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
  return { boxes, created, round, view, main, anchors };
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

  it('rebuild_DisposesTheFirstBuildsAnchors', () => {
    const { round, view, anchors } = roundViewSetup();
    const firstBuild = [...anchors];

    view.rebuild(round);

    expect(firstBuild.length).toBeGreaterThan(0);
    expect(
      firstBuild.every((anchor) => anchor.dispose.mock.calls.length === 1),
    ).toBe(true);
  });

  it('dispose_DisposesEveryAnchor', () => {
    const { view, anchors } = roundViewSetup();

    view.dispose();

    expect(anchors.length).toBeGreaterThan(0);
    expect(
      anchors.every((anchor) => anchor.dispose.mock.calls.length === 1),
    ).toBe(true);
  });
});
