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
import { apply, initialState } from './form-state';
import { mountFormsView } from './forms-view';
import { presentedRound } from './test-rounds';

const host: EditorHost = {
  create: (_parent, doc, events) => ({
    text: () => doc,
    setText: () => undefined,
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

// Round r1 open and active in its session's Form tab, the visible tab; `tab`
// is the tab's element.
function formTabSetup() {
  const presented = presentedRound('r1');
  const store = createReducerStore(
    initialState([presented], presented.sessionId),
    apply,
  );
  const boxes = createEditorBoxes(
    host,
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
    FORMS_BOX_IDENTITY,
  );
  let tab: FakeElement | null = null;
  mountFormsView({
    areas: {
      statusBar: { contribute: () => ({ dispose: () => undefined }) },
      overlay: { contribute: () => ({ dispose: () => undefined }) },
    },
    sessions: {
      addTab: (_sessionId, view) => {
        tab = asFake(view.element);
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
    setScope: () => undefined,
    onViewChanged: () => undefined,
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
    },
    run: () => undefined,
    commands: { exists: () => false, run: vi.fn() },
    contributions: createFormsContributions(),
    platform: 'macos',
    uiState: { get: () => undefined, set: () => undefined },
    log: () => undefined,
  });
  if (tab === null) {
    throw new Error('forms mounted no tab');
  }
  return { store, sessionId: presented.sessionId, tab: tab as FakeElement };
}

// The round's items pane, which holds its cards.
function itemsPane(tab: FakeElement): FakeElement {
  const [items] = findAll(tab, 'items');
  return items;
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
