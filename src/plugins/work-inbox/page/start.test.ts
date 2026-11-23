import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import { createSlotStore } from '../../../shared/state/slot-store';
import { type WorkState, workStateSlot } from '../../work/contract';
import { workItem } from '../../work/contract.test-support';
import { workInboxPlaceSlot } from '../contract';
import { workInboxPagePart } from './start';

const STATE: WorkState = {
  items: [
    workItem('newer', {
      at: '2026-11-23T11:00:00.000Z',
      ticketKeys: ['ABC-1'],
    }),
    workItem('older', { section: 'waiting' }),
  ],
  cards: [],
  suggestions: [],
  columns: [],
  job: { running: null, last: null },
  problem: null,
};

// The Inbox page on the harness, drawing its layout for real, with `STATE` published to `work.state`.
function startInboxPage() {
  installFocusFakeDom(vi.stubGlobal);
  const store = createSlotStore(() => undefined);
  store.publish(workStateSlot).set(STATE);
  return startDrawingPagePart(workInboxPagePart, {
    firstModeTaken: true,
    state: store,
  });
}

function messages(harness: ReturnType<typeof startInboxPage>): string[] {
  return harness.logs.map((line) => line.message);
}

describe('workInboxPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('showMode shows the mode and leaves it shown', () => {
    const harness = startInboxPage();
    const { commands } = harness.started();

    commands.showMode({ arg: undefined });
    commands.showMode({ arg: undefined });

    expect(harness.state.read(coreModeSlot, 'test').get()).toBe(
      'work-inbox.main',
    );
    expect(messages(harness).filter((line) => line === 'shown')).toHaveLength(
      1,
    );
  });

  it('a page load puts back the place', async () => {
    const harness = startInboxPage();
    const { commands } = harness.started();
    commands.showMode({ arg: undefined });
    commands.selectSection({ arg: 'waiting' });
    const saved = harness.state.read(workInboxPlaceSlot, 'test').get();

    await harness.restart();
    harness.started().commands.showMode({ arg: undefined });

    expect(saved).toEqual({
      section: 'waiting',
      ticketFilter: null,
      cursorId: 'older',
      drafts: {},
    });
    expect(harness.state.read(workInboxPlaceSlot, 'test').get()).toEqual(saved);
    expect(harness.modeContext('work-inbox.main')).toEqual({
      title: 'Inbox',
      detail: 'Waiting on others',
    });
  });

  it('filterTicket shows the mode filtered with the list focused', () => {
    const harness = startInboxPage();

    harness.started().commands.filterTicket({ arg: 'ABC-1' });

    expect(harness.state.read(coreModeSlot, 'test').get()).toBe(
      'work-inbox.main',
    );
    expect(harness.modeContext('work-inbox.main')).toEqual({
      title: 'Inbox',
      detail: 'ABC-1',
    });
    expect(harness.scope()).toBe('work-inbox.list');
    expect(messages(harness)).toContain('filter ABC-1');
  });
});
