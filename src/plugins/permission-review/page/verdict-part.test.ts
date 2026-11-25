import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntryPartContext } from '../../chat/contract';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { chatReviewKey, confirmReviewKey, type Review } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, VerdictInput } from '../layouts/layout';
import { createVerdictParts } from './verdict-part';

const SESSION = 's1';
const ENTRY = 'e3';
const KEY = chatReviewKey(SESSION, ENTRY);
const ROUND = 'round-7';

const REVIEWING: Review = { state: 'reviewing' };
const APPROVE_LOW: Review = {
  state: 'done',
  summary: 'Reads one file in the project.',
  verdict: 'approve',
  risk: 'low',
};
// The permission entry's input as chat hands it to the part.
type PermissionInput = ChatEntryPartContext<'permission'>['input'];

const DENY_HIGH: Review = {
  state: 'done',
  summary: 'Deletes the home folder.',
  verdict: 'deny',
  risk: 'high',
};

function permissionInput(
  answer: PermissionInput['answer'] = null,
): PermissionInput {
  return {
    kind: 'permission',
    id: ENTRY,
    toolName: 'Bash',
    summary: 'rm -rf ~',
    input: { command: 'rm -rf ~' },
    answer,
    raw: [],
  };
}

// One verdict a recording layout drew: the layout's name, the wrapper it drew
// into and its input.
interface Recorded {
  layout: string;
  parent: FakeElement;
  input: VerdictInput;
}

// A layout that records each verdict it draws as `div.recorded-verdict`, its
// heading in `data-heading`, naming one key anchor so its dispose shows. With
// `updates`, each part takes later inputs in place, recording them there.
function recordingLayout(
  name: string,
  records: Recorded[],
  updates?: VerdictInput[],
): Layout {
  return {
    verdict(parent, input, kit) {
      records.push({ layout: name, parent: asFake(parent), input });
      const element = kit.el(parent, 'div', 'recorded-verdict');
      element.dataset.heading = input.heading;
      kit.keyHint(element, 'chat.allow');
      if (updates === undefined) {
        return { element };
      }
      return {
        element,
        update(next) {
          updates.push(next);
          element.dataset.heading = next.heading;
        },
      };
    },
  };
}

// Parts over reviews and confirm rounds the test sets, drawn by a recording
// layout (`updates` as recordingLayout's); parents hang under a page root
// unless detached.
function setUp(updates?: VerdictInput[]) {
  const reviews = new Map<string, Review>();
  const confirmRounds = new Set<string>();
  const logged: string[] = [];
  const records: Recorded[] = [];
  const { anchors, keys } = recordingAnchors();
  const parts = createVerdictParts({
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    log: (message) => logged.push(message),
    review: (key) => reviews.get(key),
    isConfirmRound: (roundId) => confirmRounds.has(roundId),
  });
  parts.setLayouts(
    withUser<Layout>(defaultLayout, recordingLayout('mine', records, updates)),
  );
  const root = new FakeElement('div');
  root.isPageRoot = true;
  const attached = () => {
    const parent = new FakeElement('div');
    root.append(parent);
    return parent;
  };
  const buildEntry = (
    parent: FakeElement,
    answer?: PermissionInput['answer'],
  ) =>
    parts.entryPart.build(asHtml(parent), {
      sessionId: SESSION,
      input: permissionInput(answer),
    });
  const buildCard = (parent: FakeElement) =>
    parts.cardPart.build(asHtml(parent), {
      roundId: ROUND,
      kind: 'question',
      index: 1,
    });
  const setReview = (review: Review | null, key = KEY) => {
    if (review === null) {
      reviews.delete(key);
    } else {
      reviews.set(key, review);
    }
    parts.reviewChanged(key);
  };
  const openConfirm = () => {
    confirmRounds.add(ROUND);
    parts.confirmChanged(ROUND);
  };
  const headings = (parent: FakeElement) =>
    findAll(parent, 'recorded-verdict').map(
      (element) => element.dataset.heading,
    );
  return {
    parts,
    reviews,
    confirmRounds,
    logged,
    records,
    anchors,
    attached,
    buildEntry,
    buildCard,
    setReview,
    openConfirm,
    headings,
  };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createVerdictParts', () => {
  it('draws nothing for an entry with no review', () => {
    const { attached, buildEntry, records, logged } = setUp();
    const parent = attached();

    buildEntry(parent);

    expect(parent.children).toEqual([]);
    expect(records).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('redraws every connected part of a key when its review changes, and logs the heading once', () => {
    const { attached, buildEntry, setReview, headings, logged } = setUp();
    setReview(REVIEWING);
    const first = attached();
    const second = attached();
    buildEntry(first);
    buildEntry(second);

    setReview(APPROVE_LOW);

    expect([headings(first), headings(second)]).toEqual([
      ['Approve · low risk'],
      ['Approve · low risk'],
    ]);
    expect(logged).toEqual([
      'verdict s1/e3: Reviewing…',
      'verdict s1/e3: Approve · low risk',
    ]);
  });

  it('keeps the verdict when chat updates an answered entry', () => {
    const { attached, buildEntry, setReview, headings } = setUp();
    setReview(DENY_HIGH);
    const parent = attached();
    const built = buildEntry(parent);

    built.update?.(permissionInput({ allowed: false, reason: null }));

    expect(headings(parent)).toEqual(['Deny · high risk']);
  });

  it('sweeps a detached holder of a key when chat builds that key again, disposing its draw', () => {
    const { attached, buildEntry, setReview, records, anchors } = setUp();
    setReview(REVIEWING);
    const detached = new FakeElement('div');
    buildEntry(detached);
    const current = attached();
    buildEntry(current);
    const before = records.length;

    setReview(APPROVE_LOW);

    expect(records.slice(before).map(({ parent }) => parent)).toEqual([
      current,
    ]);
    expect(anchors[0]?.isDisposed).toBe(true);
  });

  it('redraws a detached holder, so a view put back shows the current verdict', () => {
    const { attached, buildEntry, setReview, headings } = setUp();
    setReview(REVIEWING);
    const view = attached();
    const parent = new FakeElement('div');
    view.append(parent);
    buildEntry(parent);
    view.remove();

    setReview(DENY_HIGH);
    attached().append(view);

    expect(headings(parent)).toEqual(['Deny · high risk']);
  });

  it('empties every holder when its review is deleted, and logs nothing', () => {
    const { attached, buildEntry, setReview, logged } = setUp();
    setReview(APPROVE_LOW);
    const first = attached();
    const second = attached();
    buildEntry(first);
    buildEntry(second);
    const loggedBefore = [...logged];

    setReview(null);

    expect([first.children, second.children]).toEqual([[], []]);
    expect(logged).toEqual(loggedBefore);
  });

  it.each<{
    case: string;
    act: (setUpResult: ReturnType<typeof setUp>) => void;
    expected: {
      builtBy: string[];
      updates: string[];
      headings: (string | undefined)[];
      isFirstDrawDisposed: boolean;
    };
  }>([
    {
      case: 'DoneToDone_UpdatesInPlaceAndBuildsNothing',
      act: ({ setReview }) => setReview(DENY_HIGH),
      expected: {
        builtBy: ['mine'],
        updates: ['Deny · high risk'],
        headings: ['Deny · high risk'],
        isFirstDrawDisposed: false,
      },
    },
    {
      case: 'ToNull_DisposesAndEmptiesWithoutUpdate',
      act: ({ setReview }) => setReview(null),
      expected: {
        builtBy: ['mine'],
        updates: [],
        headings: [],
        isFirstDrawDisposed: true,
      },
    },
    {
      case: 'SetLayouts_RedrawsThroughTheNewLayout',
      act: ({ parts, records }) =>
        parts.setLayouts(
          withUser<Layout>(
            defaultLayout,
            recordingLayout('second', records),
            'second',
          ),
        ),
      expected: {
        builtBy: ['mine', 'second'],
        updates: [],
        headings: ['Approve · low risk'],
        isFirstDrawDisposed: true,
      },
    },
  ])('redraw_$case', ({ act, expected }) => {
    const updates: VerdictInput[] = [];
    const harness = setUp(updates);
    harness.setReview(APPROVE_LOW);
    const parent = harness.attached();
    harness.buildEntry(parent);

    act(harness);

    expect({
      builtBy: harness.records.map(({ layout }) => layout),
      updates: updates.map(({ heading }) => heading),
      headings: harness.headings(parent),
      isFirstDrawDisposed: harness.anchors[0]?.isDisposed,
    }).toEqual(expected);
  });

  it.each<{
    case: string;
    isOpenAtBuild: boolean;
    opensAfterBuild: boolean;
    expected: (string | undefined)[];
  }>([
    {
      case: 'NotAConfirmRound_EmptyWithAReviewPresent',
      isOpenAtBuild: false,
      opensAfterBuild: false,
      expected: [],
    },
    {
      case: 'ConfirmRound_Draws',
      isOpenAtBuild: true,
      opensAfterBuild: false,
      expected: ['Approve · low risk'],
    },
    {
      case: 'RoundArrivesAfterTheBuild_DrawsOnConfirmChanged',
      isOpenAtBuild: false,
      opensAfterBuild: true,
      expected: ['Approve · low risk'],
    },
  ])('confirmCard_$case', ({ isOpenAtBuild, opensAfterBuild, expected }) => {
    const harness = setUp();
    const { attached, buildCard, setReview, confirmRounds } = harness;
    setReview(APPROVE_LOW, confirmReviewKey(ROUND));
    if (isOpenAtBuild) {
      confirmRounds.add(ROUND);
    }
    const parent = attached();
    buildCard(parent);

    if (opensAfterBuild) {
      harness.openConfirm();
    }

    expect(harness.headings(parent)).toEqual(expected);
  });

  it.each<{
    case: string;
    review: Review;
    expected: {
      heading: string | undefined;
      detail: string | null;
      risk: string | undefined;
    };
  }>([
    {
      case: 'Reviewing_HeadingOnlyAndNoRisk',
      review: REVIEWING,
      expected: { heading: 'Reviewing…', detail: null, risk: undefined },
    },
    {
      case: 'Done_HeadingDetailAndRisk',
      review: DENY_HIGH,
      expected: {
        heading: 'Deny · high risk',
        detail: 'Deletes the home folder.',
        risk: 'high',
      },
    },
    {
      case: 'Unavailable_HeadingAndReasonWithNoRisk',
      review: { state: 'unavailable', reason: 'fake ask failed' },
      expected: {
        heading: 'Review unavailable',
        detail: 'fake ask failed',
        risk: undefined,
      },
    },
  ])('defaultLayout_$case', ({ review, expected }) => {
    const { parts, attached, buildEntry, setReview } = setUp();
    parts.setLayouts(withUser<Layout>(defaultLayout, {}));
    setReview(review);
    const parent = attached();

    buildEntry(parent);

    const verdict = findAll(parent, 'permission-review-verdict')[0];
    expect({
      heading: findAll(parent, 'permission-review-verdict-heading')[0]
        ?.textContent,
      detail:
        findAll(parent, 'permission-review-verdict-detail')[0]?.textContent ??
        null,
      risk: verdict?.dataset.risk,
    }).toEqual(expected);
  });
});
