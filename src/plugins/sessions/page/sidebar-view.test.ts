import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import { sessionRow } from '../contract.test-support';
import { sessionsPartsSetup } from './sessions-view-fakes';
import { mountSidebarView } from './sidebar-view';

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sidebar view', () => {
  // Breaks: a dispose that stops at the first throwing row dispose and leaves
  // the pane drawn.
  it('disposes the pane even when a drawn row refuses to dispose', () => {
    const { parts } = sessionsPartsSetup();
    let paneDisposes = 0;
    const view = mountSidebarView(
      {
        activate: () => undefined,
        toggleFavorite: () => undefined,
        dropped: () => undefined,
      },
      {
        ...parts,
        sideBar(parent) {
          const drawn = parts.sideBar(parent);
          return {
            ...drawn,
            dispose() {
              paneDisposes++;
              drawn.dispose();
            },
          };
        },
        row(parent, input) {
          const drawn = parts.row(parent, input);
          return {
            ...drawn,
            dispose() {
              drawn.dispose();
              throw new Error('row refused');
            },
          };
        },
      },
      { set: () => 0, clear: () => undefined },
      () => new Map(),
    );
    const row = sessionRow('a1', { project: 'alpha' });
    view.render(
      { rows: [row], selectedSessionId: null },
      {
        favorites: [],
        recent: [{ project: 'alpha', isFavorite: false, rows: [row] }],
        plugins: [],
      },
      () => ({
        title: null,
        activity: null,
        partTooltips: () => [],
        onScreen: false,
      }),
      new Set(),
      { sessionId: null, hasKeys: false },
    );

    expect(() => view.dispose()).toThrow('row refused');

    expect(paneDisposes).toBe(1);
  });
});
