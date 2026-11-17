import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANE_RESIZE_COMMANDS } from '../../../contracts/panes';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
} from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import { type BoxRef, FORMS_BOX_IDENTITY } from './boxes';
import { createFormsContributions } from './contributions';
import type { RoundState } from './form-state';
import { asFake, findAll, installFakeDom } from '../../../shared/page/test-dom';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import { formsManifest } from '../manifest';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { pageKindTable } from './kinds/page-kinds';
import { createRoundView } from './round-view';
import {
  apply,
  initialState,
  notice,
  presentedRound,
  question,
} from './test-rounds';
import {
  fencePlaceholder,
  installMarkdownDom,
  NO_FENCES,
} from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

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
        insert: () => undefined,
        charBeforeCursor: () => '',
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
    takesChordKey: () => false,
    typeInto: () => {},
    onPendingKeys: () => ({ dispose: () => {} }),
    cancelPendingKeys: () => {},
    setKeymap: () => {},
  };
  return { host, created };
}

// Whether `command` is one of the resize commands a split's prompt anchors.
function isPaneResizeCommand(command: string): boolean {
  return Object.values<string>(PANE_RESIZE_COMMANDS).includes(command);
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

// Round r1, open and active, shown in the forms view by a round view over
// editor boxes; `main` is the scrolled main column, and `anchors` holds every
// anchor the keys named, in call order. It draws with `layout` over `default`
// and renders through `markdown`. The round is `presented` (two questions by
// default) as `shape` changes it.
function roundViewSetup(
  layout: Layout = bareLayout,
  markdown: MarkdownRenderer = {
    block: (text) => text,
    inline: (text) => text,
    document: async (text) => text,
    ...NO_FENCES,
  },
  presented = presentedRound('r1'),
  shape: (round: RoundState) => RoundState = (round) => round,
) {
  const { boxes, created } = setup();
  const { anchors, keys } = recordingAnchors();
  const shown = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
  const round = shape(shown.forms[0]);
  const view = createRoundView(
    () => undefined,
    round,
    withUser(defaultLayout, layout),
    {
      markdown,
      boxes,
      keys: { ...keys, onKeymapChanged: () => ({ dispose: () => undefined }) },
      run: vi.fn(),
      commands: fakeKitCommandsOf(formsManifest),
      contributions: createFormsContributions(),
      platform: 'macos',
      state: noLayoutState,
      uiState: { get: () => undefined, set: () => undefined },
      timers: { set: () => 0, clear: () => undefined },
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

  it('update_KindLeavesWhileItsCardShows_RebuildsWithoutItsCards', () => {
    const presented = presentedRound('r1');
    const { view } = roundViewSetup(bareLayout, undefined, presented);
    expect(findAll(asFake(view.element), 'bare')).toHaveLength(2);
    const withoutQuestions = pageKindTable(
      BUILT_IN_PAGE_KINDS.filter((kind) => kind.spec.id !== 'question'),
    );
    const shown = apply(initialState([], presented.sessionId), {
      type: 'formShown',
      form: presented,
    });
    const left = apply(shown, {
      type: 'kindsChanged',
      kinds: withoutQuestions,
    }).forms[0];

    expect(() => view.update(left, 'forms')).not.toThrow();
    expect(findAll(asFake(view.element), 'bare')).toHaveLength(0);
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

  it('rebuild_OpenNoticeLine_KeepsItOpenItsCursorAndItsFocusedBox', () => {
    const { boxes, round, view } = roundViewSetup(
      bareLayout,
      undefined,
      presentedRound('r1', {
        questions: [question('Alpha')],
        notices: [notice('Heads up'), notice('Also')],
      }),
      (shown) => ({
        ...shown,
        focus: 1,
        openNotices: [false, true],
        noticeLine: 2,
      }),
    );
    const comment: BoxRef = {
      roundId: 'r1',
      target: { field: 'comment', item: { kind: 'notice', index: 2 } },
    };
    boxes.focus(comment);

    view.rebuild(round);

    expect(boxes.active()).toEqual(comment);
    const line = findAll(asFake(view.element), 'notice-line')[1];
    expect(line.classList.contains('is-open')).toBe(true);
    expect(line.classList.contains('is-cursor')).toBe(true);
  });

  it('rebuild_DisposesTheFirstBuildsAnchors', () => {
    const { round, view, anchors } = roundViewSetup();
    // A rebuild keeps the split, and with it the split's resize prompt.
    const firstBuild = anchors.filter(
      (anchor) => !isPaneResizeCommand(anchor.command),
    );

    view.rebuild(round);

    expect(firstBuild.length).toBeGreaterThan(0);
    expect(firstBuild.every((anchor) => anchor.isDisposed)).toBe(true);
  });

  it('rebuild_KeepsTheSplitPrompt', () => {
    const { round, view, anchors } = roundViewSetup();

    view.rebuild(round);

    const splitPrompt = anchors.filter((anchor) =>
      isPaneResizeCommand(anchor.command),
    );
    expect(splitPrompt.length).toBeGreaterThan(0);
    expect(splitPrompt.some((anchor) => anchor.isDisposed)).toBe(false);
  });

  it('dispose_DisposesEveryAnchor', () => {
    const { view, anchors } = roundViewSetup();

    view.dispose();

    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.some((anchor) => isPaneResizeCommand(anchor.command))).toBe(
      true,
    );
    expect(anchors.every((anchor) => anchor.isDisposed)).toBe(true);
  });
});

describe('round view fences', () => {
  beforeEach(() =>
    installMarkdownDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispose disposes the fence views its cards drew', () => {
    const disposals: number[] = [];
    const html = {
      language: 'html',
      live: true,
      mount: () => {
        const index = disposals.push(0) - 1;
        return {
          element: document.createElement('div'),
          dispose: () => {
            disposals[index] += 1;
          },
        };
      },
    };
    const { view } = roundViewSetup(
      {},
      {
        block: () => fencePlaceholder('html', true, 'x'),
        inline: (text) => text,
        document: async (text) => text,
        addFence: () => ({ dispose: () => undefined }),
        fence: (language) => (language === 'html' ? html : undefined),
        addBlock: () => ({ dispose: () => undefined }),
      },
    );

    view.dispose();

    expect(disposals.length).toBeGreaterThan(0);
    expect(disposals.every((count) => count === 1)).toBe(true);
  });
});
