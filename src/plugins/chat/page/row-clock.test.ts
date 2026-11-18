import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout, PartView, RowClockInput } from '../layouts/layout';
import { createChatLayouts, surfaceBaseKit } from './chat-layouts';
import { createRowClock } from './row-clock';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const NOW = 50_000_000;
const SESSION = 's1';

// A row clock over a clock and records the test sets and timers it fires.
function setUp() {
  const { timers, armed, fireAll } = fakeTimers();
  const clock = { time: NOW, now: () => clock.time };
  const records = new Map<string, ActiveTime>();
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const layouts = createChatLayouts(log);
  const kit = {
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: (text: string) => Promise.resolve(text),
      ...NO_FENCES,
    },
    keys: recordingAnchors().keys,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    platform: 'macos' as const,
    state: noLayoutState,
    log,
  };
  const rowClock = createRowClock({
    layouts,
    kit,
    clock,
    timers,
    log,
    activeTime: (sessionId) => records.get(sessionId) ?? null,
  });
  // The row part drawn into a fresh wrapper, for `sessionId`.
  const drawRow = (sessionId = SESSION) => {
    const wrapper = new FakeElement('div');
    const drawn = rowClock.part.build(asHtml(wrapper), sessionId);
    return { wrapper, dispose: () => drawn.dispose?.() };
  };
  const { duration } = surfaceBaseKit(kit, 'chat', {
    recordAnchor: () => undefined,
  });
  // One second on the clock and the timers.
  const passSecond = () => {
    clock.time += 1000;
    fireAll();
  };
  return {
    rowClock,
    layouts,
    records,
    clock,
    armed,
    drawRow,
    duration,
    passSecond,
    logs,
  };
}

describe('createRowClock', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: 'unheld', time: null, ms: null, ticks: 0 },
    {
      name: 'paused at 0',
      time: { totalMs: 0, since: null },
      ms: 0,
      ticks: 0,
    },
    {
      name: 'paused at 65000',
      time: { totalMs: 65_000, since: null },
      ms: 65_000,
      ticks: 0,
    },
    {
      name: 'running from now - 5000',
      time: { totalMs: 0, since: NOW - 5000 },
      ms: 5000,
      ticks: 1,
    },
  ])('build_RowDraws ($name)', ({ time, ms, ticks }) => {
    const { records, drawRow, duration, armed } = setUp();
    if (time !== null) {
      records.set(SESSION, time);
    }

    const { wrapper } = drawRow();

    expect(wrapper.textContent).toBe(ms === null ? '' : duration(ms));
    expect(wrapper.childNodes.length).toBe(ms === null ? 0 : 1);
    expect(armed.size).toBe(ticks);
  });

  it('changed_EmptyRowsClockStarts_DrawsThePartAndTicks', () => {
    const { rowClock, records, drawRow, duration, armed } = setUp();
    records.set(SESSION, { totalMs: 0, since: null });
    const { wrapper } = drawRow();

    records.set(SESSION, { totalMs: 0, since: NOW - 2000 });
    rowClock.changed(SESSION);

    expect(wrapper.textContent).toBe(duration(2000));
    expect(armed.size).toBe(1);
  });

  it('tick_RunningRow_TextOneSecondLaterAndTicksAgain', () => {
    const { records, drawRow, duration, armed, passSecond } = setUp();
    records.set(SESSION, { totalMs: 3000, since: NOW });
    const { wrapper } = drawRow();
    const drawn = wrapper.childNodes[0];

    passSecond();

    expect(wrapper.textContent).toBe(duration(4000));
    expect(wrapper.childNodes).toEqual([drawn]);
    expect(armed.size).toBe(1);
  });

  it('changed_RunningRowsClockStops_ShowsTheStoppedTotalAndNoTick', () => {
    const { rowClock, records, drawRow, duration, armed } = setUp();
    records.set(SESSION, { totalMs: 0, since: NOW - 1000 });
    const { wrapper } = drawRow();

    records.set(SESSION, { totalMs: 90_000, since: null });
    rowClock.changed(SESSION);

    expect(wrapper.textContent).toBe(duration(90_000));
    expect(armed.size).toBe(0);
  });

  it('changed_TwoRunningRowsOneStops_OtherStillAdvancesAndOneTickStays', () => {
    const { rowClock, records, drawRow, duration, armed, passSecond } = setUp();
    records.set('a', { totalMs: 0, since: NOW });
    records.set('b', { totalMs: 0, since: NOW });
    const rowA = drawRow('a');
    const rowB = drawRow('b');

    records.set('a', { totalMs: 5000, since: null });
    rowClock.changed('a');
    const armedAfterStop = armed.size;
    passSecond();

    expect(armedAfterStop).toBe(1);
    expect(rowA.wrapper.textContent).toBe(duration(5000));
    expect(rowB.wrapper.textContent).toBe(duration(1000));
    expect(armed.size).toBe(1);
  });

  it('changed_ClockResetToZero_ShowsTheZeroText', () => {
    const { rowClock, records, drawRow, duration, armed } = setUp();
    records.set(SESSION, { totalMs: 0, since: NOW - 1000 });
    const { wrapper } = drawRow();

    records.set(SESSION, { totalMs: 0, since: null });
    rowClock.changed(SESSION);

    expect(wrapper.textContent).toBe(duration(0));
    expect(armed.size).toBe(0);
  });

  it('dispose_RunningRow_NoUpdateAndNoTimerPending', () => {
    const { rowClock, records, drawRow, armed, passSecond } = setUp();
    records.set(SESSION, { totalMs: 0, since: NOW });
    const { wrapper, dispose } = drawRow();

    dispose();

    expect(armed.size).toBe(0);
    passSecond();
    rowClock.changed(SESSION);
    expect(armed.size).toBe(0);
    expect(wrapper.childNodes).toEqual([]);
  });

  it('build_RowDrawnAgainBeforeTheLastDispose_LastDisposeLeavesTheNewRow', () => {
    const { records, drawRow, armed } = setUp();
    records.set(SESSION, { totalMs: 0, since: NOW });
    const earlier = drawRow();
    const { wrapper } = drawRow();

    earlier.dispose();

    expect(armed.size).toBe(1);
    expect(wrapper.childNodes.length).toBe(1);
  });

  it.each([
    {
      name: 'no update',
      viewOf: (element: HTMLElement): PartView<RowClockInput> => ({ element }),
    },
    {
      name: 'an update that throws',
      viewOf: (element: HTMLElement): PartView<RowClockInput> => ({
        element,
        update() {
          throw new Error('broken');
        },
      }),
    },
  ])('tick_LayoutRowClock_DrawnAgain ($name)', ({ viewOf }) => {
    const { layouts, records, drawRow, duration, passSecond } = setUp();
    const rowClock: ChatLayout['rowClock'] = (parent, input) => {
      const element = document.createElement('b');
      element.textContent = input.text;
      parent.append(element);
      return viewOf(element);
    };
    layouts.set(withUser<ChatLayout>(defaultLayout, { rowClock }));
    records.set(SESSION, { totalMs: 0, since: NOW });
    const { wrapper } = drawRow();

    passSecond();

    expect(wrapper.textContent).toBe(duration(1000));
    expect(wrapper.childNodes.length).toBe(1);
  });

  it('layoutsChange_KeptRow_DrawsWithTheNewLayout', () => {
    const { layouts, records, drawRow } = setUp();
    records.set(SESSION, { totalMs: 65_000, since: null });
    const { wrapper } = drawRow();
    const rowClock: ChatLayout['rowClock'] = (parent) => {
      const element = document.createElement('b');
      element.textContent = 'mine';
      parent.append(element);
      return { element };
    };

    layouts.set(withUser<ChatLayout>(defaultLayout, { rowClock }));

    expect(wrapper.textContent).toBe('mine');
    expect(wrapper.childNodes.length).toBe(1);
  });
});
