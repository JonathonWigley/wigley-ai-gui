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
import type { RoundState } from './round-model';
import { asFake, findAll, installFakeDom } from '../../../shared/page/test-dom';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import { formsManifest } from '../manifest';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { pageKindTable } from './kinds/page-kinds';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import type { FormsAction, FormsState } from './form-state';
import { createRoundView } from './round-view';
import { railHeadInput } from './view-model';
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
    defineEx: () => ({ dispose() {} }),
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
// default) as `shape` changes it; `shown` is the state it was shown in.
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
  return { boxes, created, round, view, main, anchors, shown };
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

  it('update_KindArrivesForItemsTheRoundHolds_RebuildsWithItsCards', () => {
    const presented = presentedRound('r1', { items: { poll: [poll('P1')] } });
    const pollLayout: Layout = {
      ...bareLayout,
      cards: {
        ...bareLayout.cards,
        kinds: {
          poll: (cardParent, _input, kit) => ({
            element: kit.card(cardParent, 'poll-card'),
          }),
        },
      },
    };
    const { view } = roundViewSetup(pollLayout, undefined, presented);
    expect(findAll(asFake(view.element), 'poll-card')).toHaveLength(0);
    const shown = apply(initialState([], presented.sessionId), {
      type: 'formShown',
      form: presented,
    });
    const arrived = apply(shown, {
      type: 'kindsChanged',
      kinds: pageKindTable([...BUILT_IN_PAGE_KINDS, pollPageKind('poll')]),
    }).forms[0];

    view.update(arrived, 'forms');

    expect(findAll(asFake(view.element), 'poll-card')).toHaveLength(1);
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

// The shown round after `actions`, keeping the kinds `shown` holds, so the
// view updates rather than rebuilds.
function roundAfter(shown: FormsState, actions: FormsAction[]): RoundState {
  return actions.reduce(apply, shown).forms[0];
}

// Answers question 2 with its first choice, then focuses question 1 again.
const ANSWER_THE_OTHER_QUESTION: FormsAction[] = [
  { type: 'focusItem', item: 1 },
  { type: 'choose', number: 1 },
  { type: 'focusItem', item: 0 },
];

// Whether each element of `className` in the view carries `is-no-target`.
function noTargetMarks(view: { element: HTMLElement }, className: string) {
  return findAll(asFake(view.element), className).map((edge) =>
    edge.classList.contains('is-no-target'),
  );
}

describe('round view chrome', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      case: 'the rail head with no other untouched item',
      presented: presentedRound('r1'),
      actions: ANSWER_THE_OTHER_QUESTION,
      edge: 'rail-edge',
      before: [false],
      after: [true],
    },
    {
      case: 'the pager of a one-stop round',
      presented: presentedRound('r1', { questions: [question('Alpha')] }),
      actions: [],
      edge: 'item-pager-edge',
      before: [true, true],
      after: [true, true],
    },
  ])(
    'formsChrome_NoTarget_MarksItsEdges on $case',
    ({ presented, actions, edge, before, after }) => {
      const { view, shown } = roundViewSetup(bareLayout, undefined, presented);
      expect(noTargetMarks(view, edge)).toEqual(before);

      view.update(roundAfter(shown, actions), 'forms');

      expect(noTargetMarks(view, edge)).toEqual(after);
    },
  );

  it('railHead_Redraw_LeavesOneRootInItsSlot', () => {
    const { view, anchors, shown } = roundViewSetup();

    view.update(roundAfter(shown, ANSWER_THE_OTHER_QUESTION), 'forms');

    const [slot] = findAll(asFake(view.element), 'rail-head-slot');
    expect(slot.children).toHaveLength(1);
    const unanswered = anchors.filter(
      (anchor) => anchor.command === 'forms.prevUnanswered',
    );
    expect(unanswered.map((anchor) => anchor.isDisposed)).toEqual([
      true,
      false,
    ]);
    view.dispose();
    expect(unanswered.every((anchor) => anchor.isDisposed)).toBe(true);
  });

  it('railHead_InputChanges_DrawsAgain', () => {
    const texts: string[] = [];
    const layout: Layout = {
      ...bareLayout,
      railHead(parent, input, kit) {
        texts.push(input.text);
        return { element: kit.el(parent, 'header', 'mine', input.text) };
      },
    };
    const { view, round, shown } = roundViewSetup(layout);
    const answered = roundAfter(shown, ANSWER_THE_OTHER_QUESTION);

    view.update(answered, 'forms');
    view.update(answered, 'forms');

    expect(texts).toEqual([
      railHeadInput(round).text,
      railHeadInput(answered).text,
    ]);
    expect(texts[0]).not.toBe(texts[1]);
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
