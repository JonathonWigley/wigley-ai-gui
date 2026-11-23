import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  OTHER_COLUMN,
  type WorkState,
  workStateSlot,
} from '../../work/contract';
import { jiraCard } from '../../work/contract.test-support';
import { workBoardPlaceSlot } from '../contract';
import { workBoardPagePart } from './start';

const STATE: WorkState = {
  items: [],
  cards: [
    jiraCard('ABC-1', 'Backlog', { column: 'Backlog' }),
    jiraCard('ABC-2', 'Backlog', { column: 'Backlog' }),
    jiraCard('ABC-3', 'In QA', { column: 'In QA' }),
  ],
  suggestions: [],
  columns: ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done', OTHER_COLUMN],
  job: { running: null, last: null },
  problem: null,
};

// The Board page on the harness, drawing its layout for real, with `STATE` published to `work.state`.
function startBoardPage() {
  installFocusFakeDom(vi.stubGlobal);
  const store = createSlotStore(() => undefined);
  store.publish(workStateSlot).set(STATE);
  return startDrawingPagePart(workBoardPagePart, {
    firstModeTaken: true,
    state: store,
  });
}

function messages(harness: ReturnType<typeof startBoardPage>): string[] {
  return harness.logs.map((line) => line.message);
}

describe('workBoardPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('showMode shows the mode', () => {
    const harness = startBoardPage();
    const { commands } = harness.started();

    commands.showMode({ arg: undefined });
    commands.showMode({ arg: undefined });

    expect(harness.state.read(coreModeSlot, 'test').get()).toBe(
      'work-board.main',
    );
    expect(messages(harness).filter((line) => line === 'shown')).toHaveLength(
      1,
    );
    expect(harness.modeContext('work-board.main')).toEqual({
      title: 'Board',
      detail: 'Jira',
    });
  });

  it('showTicket shows the mode on the card', () => {
    const harness = startBoardPage();

    harness.started().commands.showTicket({ arg: 'ABC-3' });

    expect(harness.state.read(coreModeSlot, 'test').get()).toBe(
      'work-board.main',
    );
    expect(harness.scope()).toBe('work-board.board');
    expect(messages(harness)).toContain('flash ABC-3');
    expect(harness.state.read(workBoardPlaceSlot, 'test').get()).toEqual({
      cursorCardId: 'ABC-3',
    });
  });

  it('a page load puts back the cursor card', async () => {
    const harness = startBoardPage();
    const { commands } = harness.started();
    commands.showMode({ arg: undefined });
    commands.cardDown({ arg: undefined });
    const saved = harness.state.read(workBoardPlaceSlot, 'test').get();

    await harness.restart();
    harness.started().commands.showMode({ arg: undefined });

    expect(saved).toEqual({ cursorCardId: 'ABC-2' });
    expect(harness.state.read(workBoardPlaceSlot, 'test').get()).toEqual(saved);
    expect(messages(harness).at(-1)).toBe('selected ABC-2');
  });
});
