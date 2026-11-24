import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import {
  asFake,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { countingEditors } from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  OTHER_COLUMN,
  type WorkDetail,
  type WorkState,
  workDetailsSlot,
  workStateSlot,
} from '../../work/contract';
import { jiraCard, ticketDetail } from '../../work/contract.test-support';
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

// The Board page on the harness, drawing its layout for real, with `STATE` published to `work.state` and each of
// `details` to `work.details`.
function startBoardPage(details: readonly WorkDetail[] = []) {
  installFocusFakeDom(vi.stubGlobal);
  const store = createSlotStore(() => undefined);
  store.publish(workStateSlot).set(STATE);
  const detailsWriter = store.publish(workDetailsSlot);
  for (const detail of details) {
    detailsWriter.set(detail.id, detail);
  }
  return startDrawingPagePart(workBoardPagePart, {
    firstModeTaken: true,
    state: store,
    services: { editor: countingEditors().host, markdown: PLAIN_MARKDOWN },
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
      paneOpen: false,
      drafts: {},
    });
  });

  it('a page load puts back the cursor card and the open pane', async () => {
    const harness = startBoardPage();
    const { commands } = harness.started();
    commands.showMode({ arg: undefined });
    commands.cardDown({ arg: undefined });
    commands.togglePane({ arg: undefined });
    const saved = harness.state.read(workBoardPlaceSlot, 'test').get();

    await harness.restart();
    harness.started().commands.showMode({ arg: undefined });

    expect(saved).toEqual({
      cursorCardId: 'ABC-2',
      paneOpen: true,
      drafts: {},
    });
    expect(harness.state.read(workBoardPlaceSlot, 'test').get()).toEqual(saved);
    expect(messages(harness).at(-1)).toBe('selected ABC-2');
  });

  it('a ticket detail in work.details draws in the open pane', () => {
    const harness = startBoardPage([
      ticketDetail('ABC-1', { assignee: 'Detail person' }),
    ]);
    const { commands } = harness.started();
    commands.showMode({ arg: undefined });

    commands.togglePane({ arg: undefined });

    const sheet = asFake(harness.mode('work-board.main').element);
    expect(findAll(sheet, 'work-board-detail')[0].textContent).toContain(
      'Detail person',
    );
  });
});
