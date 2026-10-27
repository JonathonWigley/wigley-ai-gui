import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionRow } from '../contract';
import { asFake, installFakeDom } from '../../../shared/page/test-dom';
import { mountSidebarView } from './sidebar-view';

const keys: Pick<KeysPageExports, 'anchor'> = {
  anchor: () => ({ dispose: () => undefined }),
};

function sessionRow(sessionId: string): SessionRow {
  return {
    sessionId,
    label: sessionId,
    harness: null,
    marked: false,
    projectDir: null,
    hostSessionId: null,
  };
}

function sessionPair(view: ReturnType<typeof mountSidebarView>) {
  const pair = asFake(view.element).querySelector('.session-edge');
  if (pair === null) {
    throw new Error('the side bar holds no session pair');
  }
  return pair;
}

describe('mountSidebarView', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mountSidebarView_BeforeFirstState_HidesTheSessionPair', () => {
    const view = mountSidebarView(() => undefined, keys);

    expect(sessionPair(view).classList.contains('is-no-target')).toBe(true);
  });

  it('mountSidebarView_RenderWithAnotherSession_ShowsTheSessionPair', () => {
    const view = mountSidebarView(() => undefined, keys);

    view.render(
      { rows: [sessionRow('s1'), sessionRow('s2')], selectedSessionId: 's1' },
      () => null,
    );

    expect(sessionPair(view).classList.contains('is-no-target')).toBe(false);
  });
});
