import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreModeSlot } from '../../../contracts/core-state';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { countingEditors } from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type WorkDetail,
  type WorkState,
  workDetailsSlot,
  workStateSlot,
} from '../../work/contract';
import { ticketDetail, workItem } from '../../work/contract.test-support';
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

// The Inbox page on the harness, drawing its layout for real, with `state` published to `work.state`, none when
// null, and each of `details` to `work.details`.
function startInboxPage(
  details: readonly WorkDetail[] = [],
  state: WorkState | null = STATE,
) {
  installFocusFakeDom(vi.stubGlobal);
  const store = createSlotStore(() => undefined);
  if (state !== null) {
    store.publish(workStateSlot).set(state);
  }
  const detailsWriter = store.publish(workDetailsSlot);
  for (const detail of details) {
    detailsWriter.set(detail.id, detail);
  }
  return startDrawingPagePart(workInboxPagePart, {
    firstModeTaken: true,
    state: store,
    services: { editor: countingEditors().host, markdown: PLAIN_MARKDOWN },
  });
}

type Harness = ReturnType<typeof startInboxPage>;

function messages(harness: Harness): string[] {
  return harness.logs.map((line) => line.message);
}

function inboxSheet(harness: Harness) {
  return asFake(harness.mode('work-inbox.main').element);
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
    commands.togglePane({ arg: undefined });
    const saved = harness.state.read(workInboxPlaceSlot, 'test').get();

    await harness.restart();
    harness.started().commands.showMode({ arg: undefined });

    expect(saved).toEqual({
      section: 'waiting',
      ticketFilter: null,
      cursorId: 'older',
      drafts: {},
      paneOpen: true,
    });
    expect(harness.state.read(workInboxPlaceSlot, 'test').get()).toEqual(saved);
    expect(harness.modeContext('work-inbox.main')).toEqual({
      title: 'Inbox',
      detail: 'Waiting on others',
    });
    const split = findAll(inboxSheet(harness), 'work-inbox-split')[0];
    expect(split.classList.contains('is-end-hidden')).toBe(false);
  });

  it('detailOf reads a ticket record stored under a thread id as no thread detail', () => {
    const harness = startInboxPage([ticketDetail('newer')]);
    const { commands } = harness.started();
    commands.showMode({ arg: undefined });

    commands.togglePane({ arg: undefined });

    expect(
      findAll(inboxSheet(harness), 'work-inbox-detail')[0].textContent,
    ).toContain('No thread detail yet');
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

  const twoNeedYou: WorkState = {
    ...STATE,
    items: [
      workItem('first'),
      workItem('second'),
      workItem('elsewhere', { section: 'waiting' }),
    ],
  };
  const noneNeedYou: WorkState = {
    ...STATE,
    items: [workItem('elsewhere', { section: 'waiting' })],
  };

  it.each<{ name: string; published: WorkState[]; expected: number | null }>([
    { name: 'no work state', published: [], expected: null },
    { name: 'two Needs you items', published: [twoNeedYou], expected: 2 },
    {
      name: 'the section emptied',
      published: [twoNeedYou, noneNeedYou],
      expected: 0,
    },
  ])(
    'sets the mode count to the Needs you items: $name → $expected',
    ({ published, expected }) => {
      const harness = startInboxPage([], null);
      const writer = harness.state.publish(workStateSlot);

      for (const value of published) {
        writer.set(value);
      }

      expect(harness.modeCount('work-inbox.main')).toBe(expected);
    },
  );
});
