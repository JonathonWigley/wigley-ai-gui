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
    typeInto: () => {},
    onPendingKeys: () => {},
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

// Round r1 open and active in its session's Form tab, the visible tab, and
// each of `others` open in its own session's tab; `tab` is r1's tab element,
// `tabs` every tab element by session, and `calls` logs every `setScope` and
// `setResizeTarget` call, in call order. `targets` holds every drop target the
// view registered, and `inserted` every insert into a box's editor.
function formTabSetup(others: string[] = []) {
  const calls: ScopeCall[] = [];
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
      setActivity: () => undefined,
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
      ...NO_FENCES,
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
  const tab = tabs.get(presented.sessionId);
  if (tab === undefined) {
    throw new Error('forms mounted no tab for r1');
  }
  return {
    store,
    boxes,
    sessionId: presented.sessionId,
    tab,
    tabs,
    calls,
    targets,
    inserted,
  };
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

describe('form tab drop target', () => {
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
    const { store, boxes, tab, targets, inserted } = formTabSetup(['r2']);
    for (const action of actions) {
      store.dispatch(action);
    }
    const [roundRoot] = findAll(tab, 'round');
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
