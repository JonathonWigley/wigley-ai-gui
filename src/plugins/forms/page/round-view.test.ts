import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANE_RESIZE_COMMANDS } from '../../../contracts/panes';
import type {
  EditorEvents,
  EditorHost,
  FocusOptions,
} from '../../../contracts/editor';
import { uiStateOver } from '../../../shared/fake-ui-state.test-support';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { ShownLayouts } from '../../../contracts/plugin';
import { type BoxRef, FORMS_BOX_IDENTITY } from './boxes';
import { createFormsContributions } from './contributions';
import type { RoundState } from './round-model';
import {
  asFake,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import { formsManifest } from '../manifest';
import { BUILT_IN_PAGE_KINDS } from './kinds/formats';
import { pageKindTable } from './kinds/page-kinds';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import type { FormsAction, FormsState } from './form-state';
import { createRoundView } from './round-view';
import { railHeadInput, roundSaveLabel } from './view-model';
import {
  apply,
  finding,
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
// and renders through `markdown`, `extraLayouts` loaded beside them (the
// layouts it shows with are `layouts`). The round is `presented` (two
// questions by default) as `shape` changes it; `shown` is the state it was
// shown in.
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
  extraLayouts: [string, Layout][] = [],
) {
  const { boxes, created } = setup();
  const { anchors, keys } = recordingAnchors();
  const shown = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
  const round = shape(shown.forms[0]);
  const userLayouts = withUser(defaultLayout, layout);
  const layouts: ShownLayouts<Layout> = {
    layouts: new Map([...userLayouts.layouts, ...extraLayouts]),
    user: userLayouts.user,
  };
  const view = createRoundView(() => undefined, round, layouts, {
    markdown,
    boxes,
    keys: { ...keys, onKeymapChanged: () => ({ dispose: () => undefined }) },
    run: vi.fn(),
    commands: fakeKitCommandsOf(formsManifest),
    contributions: createFormsContributions(),
    platform: 'macos',
    state: noLayoutState,
    uiState: uiStateOver(new Map()),
    timers: { set: () => 0, clear: () => undefined },
    log: vi.fn(),
  });
  view.update(round, 'forms');
  const [main] = findAll(asFake(view.element), 'ui-split-end');
  return { boxes, created, round, view, main, anchors, shown, layouts };
}

// `layouts` with `name` loaded as `layout`, a new object.
function reloaded(
  layouts: ShownLayouts<Layout>,
  name: string,
  layout: Layout,
): ShownLayouts<Layout> {
  return {
    layouts: new Map([...layouts.layouts, [name, layout]]),
    user: layouts.user,
  };
}

// Every element of the view a layout drew (`data-layout-owner="forms"`): each
// card, pane, strip and the head, in tree order.
function drawnParts(view: { element: HTMLElement }): FakeElement[] {
  const found: FakeElement[] = [];
  const pending = [asFake(view.element)];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.dataset.layoutOwner === 'forms') {
      found.push(node);
    }
    pending.push(...[...node.children].reverse());
  }
  return found;
}

// Whether `after` holds the very elements of `before`, in order, once
// `before`'s `redrawn` and `after`'s `drawn`, with the parts inside each, are
// left out.
function keepsEveryOtherPart(
  before: FakeElement[],
  redrawn: FakeElement,
  after: FakeElement[],
  drawn: FakeElement,
): boolean {
  const kept = before.filter((part) => !redrawn.contains(part));
  const now = after.filter((part) => !drawn.contains(part));
  return kept.length === now.length && kept.every((part, i) => part === now[i]);
}

// Round r1, its two questions, with the round's own layout `r`.
function roundNamingR() {
  const presented = presentedRound('r1');
  presented.round = { ...presented.round, layout: 'r' };
  return presented;
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
    const editor = boxes.editorOf(questionNotes);
    boxes.focus(questionNotes);
    const [focused] = created.filter((made) => made.focusOptions.length > 0);
    const builtBefore = created.length;

    view.rebuild(round);

    expect(boxes.active()).toEqual(questionNotes);
    expect(created).toHaveLength(builtBefore);
    expect(boxes.editorOf(questionNotes)).toBe(editor);
    expect(focused.focusOptions).toHaveLength(2);
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

describe('round view setLayouts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A finding card of its own, `f-card`, leaving every box to the app.
  const findingLayout = (): Layout => ({
    cards: {
      finding: (cardParent, _input, kit) => ({
        element: kit.card(cardParent, 'f-card'),
      }),
    },
  });

  it('setLayouts_OneCardsLayoutChanged_RedrawsOnlyThatCard', () => {
    const { boxes, created, view, round, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      presentedRound('r1', {
        questions: [question('Alpha')],
        findings: [finding('Delta', { layout: 'f' })],
      }),
      undefined,
      [['f', findingLayout()]],
    );
    const questionNotes: BoxRef = {
      roundId: 'r1',
      target: { field: 'notes', item: { kind: 'question', index: 1 } },
    };
    boxes.focus(questionNotes);
    const [focused] = created.filter((made) => made.focusOptions.length > 0);
    focused.events.modeChanged({ mode: 'visual', subMode: '' });
    const editor = boxes.editorOf(questionNotes);
    const [findingBefore, questionBefore] = findAll(
      asFake(view.element),
      'items',
    )[0].children;
    const framesBefore = findAll(questionBefore, 'ui-input');
    const focusesBefore = focused.focusOptions.length;
    const before = drawnParts(view);

    view.setLayouts(reloaded(layouts, 'f', findingLayout()), round);

    const [findingAfter, questionAfter] = findAll(
      asFake(view.element),
      'items',
    )[0].children;
    expect(findingAfter).not.toBe(findingBefore);
    expect(findingAfter.classList.contains('f-card')).toBe(true);
    expect(questionAfter).toBe(questionBefore);
    expect(
      keepsEveryOtherPart(
        before,
        findingBefore,
        drawnParts(view),
        findingAfter,
      ),
    ).toBe(true);
    expect(boxes.editorOf(questionNotes)).toBe(editor);
    const framesAfter = findAll(questionAfter, 'ui-input');
    expect(framesBefore.length).toBeGreaterThan(0);
    expect(framesAfter.every((frame, i) => frame === framesBefore[i])).toBe(
      true,
    );
    expect(focused.focusOptions.slice(focusesBefore)).toEqual([undefined]);
  });

  it('setLayouts_RailFootChanged_RedrawsOnlyIt', () => {
    const railFootLayout = (): Layout => ({
      railFoot: (parent, _input, kit) => ({
        element: kit.el(parent, 'footer', 'r-foot'),
      }),
    });
    const { view, round, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      roundNamingR(),
      undefined,
      [['r', railFootLayout()]],
    );
    const [slot] = findAll(asFake(view.element), 'rail-foot-slot');
    const [footBefore] = slot.children;
    const before = drawnParts(view);

    view.setLayouts(reloaded(layouts, 'r', railFootLayout()), round);

    expect(slot.children).toHaveLength(1);
    const [footAfter] = slot.children;
    expect(footAfter).not.toBe(footBefore);
    expect(footAfter.classList.contains('r-foot')).toBe(true);
    expect(
      keepsEveryOtherPart(before, footBefore, drawnParts(view), footAfter),
    ).toBe(true);
    expect(findAll(asFake(view.element), 'rail-foot-slot')[0]).toBe(slot);
  });

  it('setLayouts_SamePicks_RedrawsNothing', () => {
    const { view, round, layouts } = roundViewSetup();
    const before = drawnParts(view);

    view.setLayouts(
      { layouts: new Map(layouts.layouts), user: layouts.user },
      round,
    );

    const after = drawnParts(view);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toHaveLength(before.length);
    expect(after.every((part, i) => part === before[i])).toBe(true);
  });

  it('setLayouts_ReviewPaneChanged_RedrawsOnlyItAndKeepsTheScroll', () => {
    const reviewLayout = (): Layout => ({
      review: (parent, _input, kit) => ({
        element: kit.el(parent, 'div', 'r-review'),
      }),
    });
    const { boxes, created, view, round, main, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      roundNamingR(),
      undefined,
      [['r', reviewLayout()]],
    );
    const roundNote: BoxRef = { roundId: 'r1', target: { field: 'note' } };
    const editor = boxes.editorOf(roundNote);
    const builtBefore = created.length;
    const [reviewBefore] = findAll(asFake(view.element), 'r-review');
    const before = drawnParts(view);
    main.scrollTop = 80;

    view.setLayouts(reloaded(layouts, 'r', reviewLayout()), round);

    const [reviewAfter] = findAll(asFake(view.element), 'r-review');
    expect(reviewAfter).not.toBe(reviewBefore);
    expect(
      keepsEveryOtherPart(before, reviewBefore, drawnParts(view), reviewAfter),
    ).toBe(true);
    expect(editor).toBeDefined();
    expect(boxes.editorOf(roundNote)).toBe(editor);
    expect(created).toHaveLength(builtBefore);
    expect(main.scrollTop).toBe(80);
  });

  it.each<{ case: string; first: Layout; next: Layout; drawsHead: boolean }>([
    {
      case: 'none to some',
      first: {},
      next: { head: (parent, _round, kit) => kit.el(parent, 'div', 'r-head') },
      drawsHead: true,
    },
    {
      case: 'some to none',
      first: { head: (parent, _round, kit) => kit.el(parent, 'div', 'r-head') },
      next: {},
      drawsHead: false,
    },
  ])(
    'setLayouts_HeadPickChanged_PlacesTheHeadBeforeThePager on $case',
    ({ first, next, drawsHead }) => {
      const { view, round, main, layouts } = roundViewSetup(
        bareLayout,
        undefined,
        roundNamingR(),
        undefined,
        [['r', first]],
      );
      expect(findAll(asFake(view.element), 'layout-head')).toHaveLength(
        drawsHead ? 0 : 1,
      );

      view.setLayouts(reloaded(layouts, 'r', next), round);

      const heads = findAll(asFake(view.element), 'layout-head');
      expect(heads).toHaveLength(drawsHead ? 1 : 0);
      if (drawsHead) {
        const [head] = heads;
        const [pagerSlot] = findAll(main, 'item-pager-slot');
        expect(head.dataset.layout).toBe('r');
        expect(findAll(head, 'r-head')).toHaveLength(1);
        expect(main.children.indexOf(head) + 1).toBe(
          main.children.indexOf(pagerSlot),
        );
      }
    },
  );

  it('setLayouts_NoticeCardChanged_RedrawsOnlyTheNoticesPane', () => {
    const noticeLayout = (): Layout => ({
      cards: {
        notice: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'n-card'),
        }),
      },
    });
    const { view, round, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      presentedRound('r1', {
        questions: [question('Alpha')],
        notices: [{ ...notice('Heads up'), layout: 'n' }],
      }),
      undefined,
      [['n', noticeLayout()]],
    );
    const [noticesBefore] = findAll(asFake(view.element), 'notices');
    const before = drawnParts(view);

    view.setLayouts(reloaded(layouts, 'n', noticeLayout()), round);

    const [noticesAfter] = findAll(asFake(view.element), 'notices');
    expect(noticesAfter).not.toBe(noticesBefore);
    expect(
      keepsEveryOtherPart(
        before,
        noticesBefore,
        drawnParts(view),
        noticesAfter,
      ),
    ).toBe(true);
  });

  it('setLayouts_RailHeadChanged_PlacesTheSaveStatusAndDisposesTheOldAnchors', () => {
    const railHeadLayout = (): Layout => ({ railHead: defaultLayout.railHead });
    const { view, round, anchors, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      roundNamingR(),
      undefined,
      [['r', railHeadLayout()]],
    );

    view.setLayouts(reloaded(layouts, 'r', railHeadLayout()), round);

    const [slot] = findAll(asFake(view.element), 'rail-head-slot');
    expect(slot.children).toHaveLength(1);
    const statusLines = findAll(asFake(view.element), 'ui-status-line');
    expect(statusLines).toHaveLength(1);
    expect(slot.children[0].contains(statusLines[0])).toBe(true);
    expect(findAll(statusLines[0], 'ui-status-line-save')[0].textContent).toBe(
      roundSaveLabel(round),
    );
    const disposedByCommand = (command: string) =>
      anchors
        .filter((anchor) => anchor.command === command)
        .map((anchor) => anchor.isDisposed);
    expect(disposedByCommand('forms.prevUnanswered')).toEqual([true, false]);
    expect(disposedByCommand('forms.nextUnanswered')).toEqual([true, false]);
  });

  it.each<{ case: string; layout: () => Layout; box: BoxRef }>([
    {
      case: 'a card',
      layout: () => ({
        cards: {
          question: (parent, _input, kit) => ({
            element: kit.card(parent, 'r-card'),
          }),
        },
      }),
      box: {
        roundId: 'r1',
        target: { field: 'notes', item: { kind: 'question', index: 1 } },
      },
    },
    {
      case: 'the review pane',
      layout: () => ({
        review: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'r-review'),
        }),
      }),
      box: { roundId: 'r1', target: { field: 'note' } },
    },
  ])(
    'setLayouts_RedrawsThePartHoldingTheFocusedBox_FocusesItAgainInsertingWithItsEditor in $case',
    ({ layout, box }) => {
      const { boxes, created, view, round, layouts } = roundViewSetup(
        bareLayout,
        undefined,
        roundNamingR(),
        undefined,
        [['r', layout()]],
      );
      boxes.focus(box);
      const [focused] = created.filter((made) => made.focusOptions.length > 0);
      focused.events.modeChanged({ mode: 'insert', subMode: '' });
      const editor = boxes.editorOf(box);
      const focusesBefore = focused.focusOptions.length;

      view.setLayouts(reloaded(layouts, 'r', layout()), round);

      expect(boxes.active()).toEqual(box);
      expect(boxes.editorOf(box)).toBe(editor);
      expect(focused.focusOptions.slice(focusesBefore)).toEqual([
        { insert: true },
      ]);
    },
  );

  it('setLayouts_RailChanged_SelectsAndShowsTheFocusedItemsEntry', () => {
    const railLayout = (): Layout => ({ rail: defaultLayout.rail });
    const { view, round, layouts } = roundViewSetup(
      bareLayout,
      undefined,
      roundNamingR(),
      (shown) => ({ ...shown, focus: 1 }),
      [['r', railLayout()]],
    );
    const shownEntries = vi.spyOn(FakeElement.prototype, 'scrollIntoView');

    view.setLayouts(reloaded(layouts, 'r', railLayout()), round);

    const entries = findAll(asFake(view.element), 'rail-entry');
    expect(
      entries.map((entry) => entry.classList.contains('is-selected')),
    ).toEqual([false, true]);
    expect(shownEntries.mock.contexts).toEqual([entries[1]]);
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
