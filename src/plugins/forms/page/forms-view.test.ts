import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import { createReducerStore } from '../../../shared/page/reducer-store';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { FORMS_BOX_IDENTITY } from './boxes';
import { createFormsContributions } from './contributions';
import { apply, type FormsAction, initialState } from './form-state';
import { mountFormsView } from './forms-view';
import { presentedRound } from './test-rounds';

const host: EditorHost = {
  create: (_parent, doc, events) => ({
    text: () => doc,
    setText: () => undefined,
    insert: () => undefined,
    charBeforeCursor: () => '',
    focus: () => events.focused(),
    blur: () => events.blurred(),
    destroy: () => undefined,
  }),
  createDocument: () => {
    throw new Error('not used by forms');
  },
  contains: () => false,
  typeInto: () => {},
  onPendingKeys: () => {},
  cancelPendingKeys: () => {},
  setKeymap: () => {},
};

// One call to the view's `setScope` or `setResizeTarget`; a target is
// `'target'` when one was set, else null.
type ScopeCall = ['setScope', string] | ['setResizeTarget', 'target' | null];

// Round r1 open and active in its session's Form tab, the visible tab, and
// each of `others` open in its own session's tab; `tab` is r1's tab element,
// `tabs` every tab element by session, and `calls` logs every `setScope` and
// `setResizeTarget` call, in call order.
function formTabSetup(others: string[] = []) {
  const calls: ScopeCall[] = [];
  const presented = presentedRound('r1');
  const store = createReducerStore(
    initialState(
      [presented, ...others.map((roundId) => presentedRound(roundId))],
      presented.sessionId,
    ),
    apply,
  );
  const boxes = createEditorBoxes(
    host,
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
    FORMS_BOX_IDENTITY,
  );
  const tabs = new Map<string, FakeElement>();
  mountFormsView({
    areas: {
      overlay: { contribute: () => ({ dispose: () => undefined }) },
    },
    sessions: {
      addTab: (sessionId, view) => {
        tabs.set(sessionId, asFake(view.element));
        return {
          setStatus: () => undefined,
          select: () => undefined,
          takeOver: () => ({ release: () => undefined }),
          isVisible: () => true,
          remove: () => undefined,
        };
      },
    },
    beforeClose: () => true,
    setScope: (view) => calls.push(['setScope', view]),
    setResizeTarget: (target) =>
      calls.push(['setResizeTarget', target === null ? null : 'target']),
    pushConfirmScope: () => ({
      pop: () => undefined,
      onBaseChanged: () => undefined,
    }),
    store,
    boxes,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    keys: {
      keysFor: () => null,
      onChanged: () => ({ dispose: () => undefined }),
      anchor: () => ({ dispose: () => undefined }),
    },
    run: () => undefined,
    commands: { exists: () => false, run: vi.fn() },
    contributions: createFormsContributions(),
    platform: 'macos',
    uiState: { get: () => undefined, set: () => undefined },
    timers: { set: () => 0, clear: () => undefined },
    log: () => undefined,
  });
  const tab = tabs.get(presented.sessionId);
  if (tab === undefined) {
    throw new Error('forms mounted no tab for r1');
  }
  return { store, sessionId: presented.sessionId, tab, tabs, calls };
}

// The round's items pane, which holds its cards.
function itemsPane(tab: FakeElement): FakeElement {
  const [items] = findAll(tab, 'items');
  return items;
}

// Whether the tab draws its round.
function roundShown(tab: FakeElement): boolean {
  const [round] = findAll(tab, 'round');
  return round.hidden !== true;
}

// The round's review pane.
function reviewPane(tab: FakeElement): FakeElement {
  const [review] = findAll(tab, 'review-pane');
  return review;
}

describe('form tab under the cancel prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the round behind a close prompt asked from the form', () => {
    const { store, sessionId, tab } = formTabSetup();

    store.dispatch({ type: 'askClose', sessionId });

    expect(store.get().view).toBe('confirm');
    expect(itemsPane(tab).hidden).toBe(false);
  });

  it('shows the review behind a cancel prompt asked from the review', () => {
    const { store, tab } = formTabSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'askCancel' });

    expect(store.get().view).toBe('confirm');
    expect(itemsPane(tab).hidden).toBe(true);
    expect(reviewPane(tab).hidden).toBe(false);
  });
});

describe('form tabs of several sessions', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws an unfocused session's round in its tab while the focused round takes the keys", () => {
    const { store, tabs, calls } = formTabSetup(['r2']);
    const unfocused = tabs.get('r2-session') as FakeElement;

    store.dispatch({ type: 'openReview' });

    expect(roundShown(unfocused)).toBe(true);
    expect(itemsPane(unfocused).hidden).toBe(false);
    expect(calls.at(-2)).toEqual(['setScope', 'review']);
    expect(store.get().activeFormId).toBe('r1');
  });

  it('draws a round that arrives for an unfocused session', () => {
    const { store, tabs } = formTabSetup();

    store.dispatch({ type: 'formShown', form: presentedRound('r2') });

    const unfocused = tabs.get('r2-session') as FakeElement;
    expect(roundShown(unfocused)).toBe(true);
    expect(itemsPane(unfocused).hidden).toBe(false);
  });
});

describe('form tab resize target', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{ action: string; actions: FormsAction[]; last: ScopeCall[] }>([
    {
      action: 'none, the round shows',
      actions: [],
      last: [
        ['setScope', 'forms'],
        ['setResizeTarget', 'target'],
      ],
    },
    {
      // The cancel prompt is asked from the review.
      action: 'askCancel',
      actions: [{ type: 'openReview' }, { type: 'askCancel' }],
      last: [
        ['setScope', 'confirm'],
        ['setResizeTarget', 'target'],
      ],
    },
    {
      action: 'formClosed for the round',
      actions: [{ type: 'formClosed', formId: 'r1' }],
      last: [
        ['setScope', 'idle'],
        ['setResizeTarget', null],
      ],
    },
  ])('$action sets the scope, then the resize target', ({ actions, last }) => {
    const { store, calls } = formTabSetup();

    for (const action of actions) {
      store.dispatch(action);
    }

    expect(calls.slice(-2)).toEqual(last);
  });
});
