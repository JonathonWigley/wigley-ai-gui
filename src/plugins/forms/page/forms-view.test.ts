import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DroppedFile, DropTarget } from '../../../contracts/drops';
import type { EditorHost, TextEditor } from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
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
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { NEEDS_YOU_ACTIVITY, type RowActivity } from '../../sessions/contract';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

// One `insert` call on an editor the host made.
interface Inserted {
  editor: TextEditor;
  text: string;
}

// An editor host whose editors record each insert into `inserted`; every
// cursor sits after an `x`.
function fakeHost(inserted: Inserted[]): EditorHost {
  return {
    create: (_parent, doc, events) => {
      const editor: TextEditor = {
        text: () => doc,
        setText: () => undefined,
        insert: (text) => {
          inserted.push({ editor, text });
        },
        charBeforeCursor: () => 'x',
        focus: () => events.focused(),
        blur: () => events.blurred(),
        destroy: () => undefined,
      };
      return editor;
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
}

// A drop target the view registered, and whether its registration was
// disposed.
interface RegisteredTarget {
  target: DropTarget;
  isDisposed: boolean;
}

// One call to the view's `setScope` or `setResizeTarget`; a target is
// `'target'` when one was set, else null.
type ScopeCall = ['setScope', string] | ['setResizeTarget', 'target' | null];

// Round r1 open and active in its session's form popup, the visible surface,
// and each of `others` open in its own session's popup; `popup` is r1's popup
// element, `popups` every popup element by session, `added` each popup's
// session and id in add order, and `calls` logs every `setScope` and
// `setResizeTarget` call, in call order. The fake `addPopup` runs the popup's
// `shown` inside the call, as sessions does for the focused session. `targets` holds every drop target the
// view registered, `inserted` every insert into a box's editor, and
// `activities` every row activity the view set.
function formPopupSetup(others: string[] = []) {
  const calls: ScopeCall[] = [];
  const activities: [string, string, RowActivity | null][] = [];
  const targets: RegisteredTarget[] = [];
  const inserted: Inserted[] = [];
  const presented = presentedRound('r1');
  const store = createReducerStore(
    initialState(
      [presented, ...others.map((roundId) => presentedRound(roundId))],
      presented.sessionId,
    ),
    apply,
  );
  const boxes = createEditorBoxes(
    fakeHost(inserted),
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
    FORMS_BOX_IDENTITY,
  );
  const popups = new Map<string, FakeElement>();
  const added: [string, string][] = [];
  mountFormsView({
    areas: {
      overlay: { contribute: () => ({ dispose: () => undefined }) },
    },
    sessions: {
      addPopup: (sessionId, view) => {
        popups.set(sessionId, asFake(view.element));
        added.push([sessionId, view.id]);
        view.shown();
        return {
          setStatus: () => undefined,
          open: () => undefined,
          hide: () => undefined,
          isVisible: () => true,
          dispose: () => undefined,
        };
      },
      setActivity: (sessionId, sourceId, activity) =>
        activities.push([sessionId, sourceId, activity]),
    },
    beforeClose: () => true,
    setScope: (view) => calls.push(['setScope', view]),
    setResizeTarget: (target) =>
      calls.push(['setResizeTarget', target === null ? null : 'target']),
    pushConfirmScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    store,
    boxes,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys: {
      keysFor: () => null,
      onKeymapChanged: () => ({ dispose: () => undefined }),
      anchor: () => ({ dispose: () => undefined }),
    },
    run: () => undefined,
    commands: { exists: () => false, argShape: () => undefined, run: vi.fn() },
    contributions: createFormsContributions(),
    platform: 'macos',
    state: noLayoutState,
    uiState: { get: () => undefined, set: () => undefined },
    timers: { set: () => 0, clear: () => undefined },
    drops: {
      addTarget: (target) => {
        const registered = { target, isDisposed: false };
        targets.push(registered);
        return {
          dispose: () => {
            registered.isDisposed = true;
          },
        };
      },
      savePasted: () => Promise.reject(new Error('not used by forms')),
    },
    toast: () => undefined,
    log: () => undefined,
  });
  const popup = popups.get(presented.sessionId);
  if (popup === undefined) {
    throw new Error('forms mounted no popup for r1');
  }
  return {
    store,
    boxes,
    sessionId: presented.sessionId,
    popup,
    popups,
    added,
    calls,
    targets,
    inserted,
    activities,
  };
}

// The round's items pane, which holds its cards.
function itemsPane(popup: FakeElement): FakeElement {
  const [items] = findAll(popup, 'items');
  return items;
}

// Whether the popup draws its round.
function roundShown(popup: FakeElement): boolean {
  const [round] = findAll(popup, 'round');
  return round.hidden !== true;
}

// The round's review pane.
function reviewPane(popup: FakeElement): FakeElement {
  const [review] = findAll(popup, 'review-pane');
  return review;
}

describe('form popup under the cancel prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the round behind a close prompt asked from the form', () => {
    const { store, sessionId, popup } = formPopupSetup();

    store.dispatch({ type: 'askClose', sessionId });

    expect(store.get().view).toBe('confirm');
    expect(itemsPane(popup).hidden).toBe(false);
  });

  it('shows the review behind a cancel prompt asked from the review', () => {
    const { store, popup } = formPopupSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'askCancel' });

    expect(store.get().view).toBe('confirm');
    expect(itemsPane(popup).hidden).toBe(true);
    expect(reviewPane(popup).hidden).toBe(false);
  });
});

describe('form popups of several sessions', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws an unfocused session's round in its popup while the focused round takes the keys", () => {
    const { store, popups, calls } = formPopupSetup(['r2']);
    const unfocused = popups.get('r2-session') as FakeElement;

    store.dispatch({ type: 'openReview' });

    expect(roundShown(unfocused)).toBe(true);
    expect(itemsPane(unfocused).hidden).toBe(false);
    expect(calls.at(-2)).toEqual(['setScope', 'review']);
    expect(store.get().activeFormId).toBe('r1');
  });

  it('draws a round that arrives for an unfocused session', () => {
    const { store, popups } = formPopupSetup();

    store.dispatch({ type: 'formShown', form: presentedRound('r2') });

    const unfocused = popups.get('r2-session') as FakeElement;
    expect(roundShown(unfocused)).toBe(true);
    expect(itemsPane(unfocused).hidden).toBe(false);
  });
});

describe('form popup opening', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a session's first round opens its popup, and the resize target is that round's split", () => {
    const { added, calls } = formPopupSetup();

    expect(added).toEqual([['r1-session', 'form']]);
    expect(calls.at(-1)).toEqual(['setResizeTarget', 'target']);
  });
});

describe('form popup row activity', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets the session's row to needs you while its round shows, and clears it when the round closes", () => {
    const { store, sessionId, activities } = formPopupSetup();

    store.dispatch({ type: 'formClosed', formId: 'r1' });

    expect(activities).toEqual([
      [sessionId, 'forms', NEEDS_YOU_ACTIVITY],
      [sessionId, 'forms', null],
    ]);
  });
});

describe('form popup resize target', () => {
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
  ])('$action sets the scope, then the resize target', ({ actions, last }) => {
    const { store, calls } = formPopupSetup();

    for (const action of actions) {
      store.dispatch(action);
    }

    expect(calls.slice(-2)).toEqual(last);
  });

  it('a closed last round leaves the scope to the surface under its popup', () => {
    const { store, calls } = formPopupSetup();
    const before = calls.length;

    store.dispatch({ type: 'formClosed', formId: 'r1' });

    expect(calls.slice(before)).toEqual([]);
  });
});

describe('form popup drop target', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const file: DroppedFile = {
    name: 'a.md',
    mediaType: 'text/markdown',
    path: '/d/a.md',
    bytes: async () => new Uint8Array(),
  };

  it.each<{ name: string; actions: FormsAction[] }>([
    { name: 'its pane focused', actions: [] },
    {
      name: 'its pane unfocused by a Chat pane',
      actions: [{ type: 'sessionActivated', sessionId: 'chat-session' }],
    },
  ])('roundView_DropTarget_FollowsTheRound with $name', async ({ actions }) => {
    const { store, boxes, popup, targets, inserted } = formPopupSetup(['r2']);
    for (const action of actions) {
      store.dispatch(action);
    }
    const [roundRoot] = findAll(popup, 'round');
    const r1Targets = targets.filter(
      ({ target }) => asFake(target.element) === roundRoot,
    );
    expect(r1Targets).toHaveLength(1);
    const [r1Target] = r1Targets;

    r1Target.target.take([file]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(inserted.map(({ text }) => text)).toEqual([
      insertionText(['/d/a.md'], 'x'),
    ]);
    expect(boxes.boxOf(inserted[0].editor)?.roundId).toBe('r1');

    store.dispatch({ type: 'formClosed', formId: 'r1' });

    expect(targets.map(({ isDisposed }) => isDisposed)).toEqual(
      targets.map((registered) => registered === r1Target),
    );
  });
});
