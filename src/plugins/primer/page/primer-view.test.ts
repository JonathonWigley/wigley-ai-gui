import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { createEditorBoxes } from '../../../shared/page/editor-boxes';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { PRIMER_BOX_IDENTITY } from './boxes';
import { initialState } from './primer-state';
import { createPrimerStore } from './primer-store';
import { mountPrimerTab } from './primer-view';
import { presentedPrimer } from './test-primers';

const host: EditorHost = {
  create: (_parent, doc, events) => ({
    text: () => doc,
    setText: () => undefined,
    focus: () => events.focused(),
    blur: () => events.blurred(),
    destroy: () => undefined,
  }),
  createDocument: () => {
    throw new Error('not used by the primer');
  },
  contains: () => false,
  typeInto: () => {},
  onPendingKeys: () => {},
  cancelPendingKeys: () => {},
  setKeymap: () => {},
};

// Primer p1 open and active in its session's Primer tab, the visible tab;
// `tab` is the tab's element.
function primerTabSetup() {
  const presented = presentedPrimer('p1');
  const store = createPrimerStore(
    initialState([presented], presented.sessionId),
  );
  const boxes = createEditorBoxes(
    host,
    { changed: () => undefined, activated: () => undefined },
    () => undefined,
    PRIMER_BOX_IDENTITY,
  );
  let tab: FakeElement | null = null;
  mountPrimerTab({
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
    platform: 'macos',
    uiState: { get: () => undefined, set: () => undefined },
    log: () => undefined,
  });
  if (tab === null) {
    throw new Error('the primer mounted no tab');
  }
  return { store, sessionId: presented.sessionId, tab: tab as FakeElement };
}

function pane(tab: FakeElement, className: string): FakeElement {
  const [found] = findAll(tab, className);
  return found;
}

describe('primer tab under the cancel prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the card behind a close prompt asked from the card', () => {
    const { store, sessionId, tab } = primerTabSetup();

    store.dispatch({ type: 'askClose', sessionId });

    expect(store.get().view).toBe('confirm');
    expect(pane(tab, 'primer-card').hidden).toBe(false);
    expect(pane(tab, 'primer-review-pane').hidden).toBe(true);
  });

  it('shows the review behind a cancel prompt asked from the review', () => {
    const { store, tab } = primerTabSetup();
    store.dispatch({ type: 'openReview' });

    store.dispatch({ type: 'askCancel' });

    expect(store.get().view).toBe('confirm');
    expect(pane(tab, 'primer-card').hidden).toBe(true);
    expect(pane(tab, 'primer-review-pane').hidden).toBe(false);
  });
});
