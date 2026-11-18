import { describe, expect, it } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import {
  closePane,
  leafIds,
  type PaneTree,
  singlePane,
} from '../../../shared/page/pane-tree/pane-tree';
import type { SessionRow } from '../contract';
import { fakeUiState, hostRow, savedSplit } from './session-fakes';
import {
  createSessionsPageModel,
  type SessionsPageModel,
  type SessionsPageModelView,
} from './sessions-page-model';

// Lets a queued microtask and a settled reply's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The model over a fake view whose panes behave as `SessionPanes` does,
// calling the model's callbacks the same way; one empty pane until a restore.
function startModel(uiState: UiState = fakeUiState()) {
  let model: SessionsPageModel;
  let tree: PaneTree = singlePane('pane-1');
  const assigned = new Map<string, string | null>([['pane-1', null]]);
  let rows: SessionRow[] = [];
  let selection: string | null = null;
  let activeId: string | null | undefined = null;
  const activated: string[] = [];
  const dropped: string[] = [];
  const tracked: { isSettled: boolean }[] = [];

  const view: SessionsPageModelView = {
    render: () => undefined,
    panes: {
      tree: () => tree,
      sessions: () => assigned,
      focusedPaneId: () => tree.focusedId,
      focusedSessionId: () => assigned.get(tree.focusedId) ?? null,
      load(paneId, sessionId) {
        assigned.set(paneId, sessionId);
        model.panesChanged();
      },
      focus(paneId) {
        if (paneId === tree.focusedId) {
          return;
        }
        tree = { ...tree, focusedId: paneId };
        model.panesChanged();
        model.paneFocused(paneId);
      },
      close(paneId) {
        const closed = closePane(tree, paneId);
        if (closed === null) {
          return false;
        }
        const focusedBefore = tree.focusedId;
        assigned.delete(paneId);
        tree = closed;
        model.panesChanged();
        if (tree.focusedId !== focusedBefore) {
          model.paneFocused(tree.focusedId);
        }
        return true;
      },
      restore(next, sessions) {
        tree = next;
        assigned.clear();
        for (const id of leafIds(next)) {
          assigned.set(id, sessions.get(id) ?? null);
        }
        model.panesChanged();
      },
    },
    tabs: {
      tabsOf: () => [],
      selectedTabOf: () => null,
      openPopupOf: () => null,
      drop: (sessionId) => dropped.push(sessionId),
    },
    list: { holdsKeys: () => false },
  };
  model = createSessionsPageModel({
    view,
    uiState,
    readRows: () => rows,
    readSelection: () => selection,
    active: {
      get: () => activeId,
      set: (sessionId) => {
        activeId = sessionId;
      },
    },
    activateInMain(sessionId) {
      activated.push(sessionId);
      return Promise.resolve(true);
    },
    isStopped: () => false,
    restores: {
      track(restore) {
        const record = { isSettled: false };
        tracked.push(record);
        void restore.then(() => {
          record.isSettled = true;
        });
      },
    },
    setContext: () => undefined,
    markToast: () => undefined,
    setIdleScope: () => undefined,
    tabShown: () => undefined,
    log: () => undefined,
  });

  return {
    model,
    // Main's rows and selection, which the next `ready` or `applyNotice`
    // reads.
    setMain(nextRows: SessionRow[], nextSelection: string | null) {
      rows = nextRows;
      selection = nextSelection;
    },
    panes: () => Object.fromEntries(assigned),
    focusedPaneId: () => tree.focusedId,
    focus: (paneId: string) => view.panes.focus(paneId),
    active: () => activeId,
    activated,
    dropped,
    tracked,
  };
}

describe('sessions page model', () => {
  it('places the saved panes at ready and settles the restore after its microtask', async () => {
    const page = startModel(savedSplit('a'));
    page.setMain([hostRow('s1'), hostRow('s2')], 's1');

    page.model.ready();

    expect(page.panes()).toEqual({ a: 's1', b: 's2' });
    expect(page.tracked).toHaveLength(1);
    await settle();
    expect(page.tracked[0].isSettled).toBe(true);
    expect(page.active()).toBe('s1');
  });

  it('publishes nothing for a rowless selection until the notice that settles it', async () => {
    const page = startModel(savedSplit('b'));
    page.setMain([hostRow('s1'), hostRow('s2')], 's2');
    page.model.ready();
    await settle();
    expect(page.active()).toBe('s2');

    page.setMain([hostRow('s1')], 's2');
    page.model.applyNotice();

    expect(page.panes()).toEqual({ a: 's1' });
    await settle();
    expect(page.active()).toBe('s2');

    page.setMain([hostRow('s1')], 's1');
    page.model.applyNotice();
    await settle();
    expect(page.active()).toBe('s1');
  });

  it('empties nothing and loads the next row into the last pane when its row leaves', async () => {
    const page = startModel();
    page.setMain([hostRow('s1')], 's1');
    page.model.ready();
    await settle();

    page.setMain([hostRow('s2')], 's2');
    page.model.applyNotice();

    expect(page.panes()).toEqual({ 'pane-1': 's2' });
    expect(page.dropped).toEqual(['s1']);
  });

  it('places nothing for the echo of its own activate', async () => {
    const page = startModel(savedSplit('a'));
    page.setMain([hostRow('s1'), hostRow('s2')], 's1');
    page.model.ready();
    await settle();

    page.focus('b');
    expect(page.activated).toEqual(['s2']);
    page.setMain([hostRow('s1'), hostRow('s2')], 's2');
    page.model.applyNotice();

    const expectNothingPlaced = () => {
      expect(page.focusedPaneId()).toBe('b');
      expect(page.panes()).toEqual({ a: 's1', b: 's2' });
      expect(page.activated).toEqual(['s2']);
    };
    expectNothingPlaced();
    await settle();
    expectNothingPlaced();
  });
});
