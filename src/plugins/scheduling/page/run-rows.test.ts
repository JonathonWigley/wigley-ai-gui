import { describe, expect, it } from 'vitest';
import type { SidebarSection } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { SchedulingState } from '../contract';
import { SCHEDULED_RUN_DONE, startRunRows } from './run-rows';

function schedulingState(
  runRows: string[],
  unviewedRows: string[],
): SchedulingState {
  return {
    tasks: [],
    fileError: null,
    fires: true,
    loginStart: null,
    runRows,
    unviewedRows,
  };
}

// `startRunRows` over a sessions that records, in order, each section added and disposed and each `setActivity`.
function startOver(state: SchedulingState) {
  const calls: unknown[][] = [];
  const sections: { section: SidebarSection; disposed: boolean }[] = [];
  const logs: string[] = [];
  const runRows = startRunRows(
    {
      sessions: {
        addSection(section) {
          const added = { section, disposed: false };
          sections.push(added);
          calls.push(['addSection', section.id]);
          return {
            dispose() {
              added.disposed = true;
              calls.push(['disposeSection', section.id]);
            },
          };
        },
        setActivity(sessionId, sourceId, activity) {
          calls.push(['setActivity', sessionId, sourceId, activity]);
        },
      },
      log: (line) => logs.push(line),
    },
    state,
  );
  const liveSections = () =>
    sections.filter(({ disposed }) => !disposed).map(({ section }) => section);
  return { runRows, calls, sections, logs, liveSections };
}

describe('startRunRows', () => {
  it('adds one Scheduled runs section that claims the slot runRows only', () => {
    const { liveSections } = startOver(schedulingState(['a', 'b'], []));

    const [section] = liveSections();
    expect(liveSections()).toHaveLength(1);
    expect(section).toMatchObject({
      id: 'scheduling',
      label: 'Scheduled runs',
      order: 900,
    });
    expect(
      ['a', 'b', 'z'].map((id) => section!.claims(sessionRow(id))),
    ).toEqual([true, true, false]);
  });

  it.each([
    {
      change: 'runRows same content',
      from: schedulingState(['a', 'b'], []),
      to: schedulingState(['a', 'b'], []),
      calls: [],
    },
    {
      change: 'runRows changed',
      from: schedulingState(['a'], []),
      to: schedulingState(['a', 'c'], []),
      calls: [
        ['disposeSection', 'scheduling'],
        ['addSection', 'scheduling'],
      ],
    },
    {
      change: "unviewedRows [] → ['a']",
      from: schedulingState(['a', 'b'], []),
      to: schedulingState(['a', 'b'], ['a']),
      calls: [['setActivity', 'a', 'scheduling', SCHEDULED_RUN_DONE]],
    },
    {
      change: "unviewedRows ['a'] → ['b']",
      from: schedulingState(['a', 'b'], ['a']),
      to: schedulingState(['a', 'b'], ['b']),
      calls: [
        ['setActivity', 'a', 'scheduling', null],
        ['setActivity', 'b', 'scheduling', SCHEDULED_RUN_DONE],
      ],
    },
    {
      change: "unviewedRows ['a', 'b'] → []",
      from: schedulingState(['a', 'b'], ['a', 'b']),
      to: schedulingState(['a', 'b'], []),
      calls: [
        ['setActivity', 'a', 'scheduling', null],
        ['setActivity', 'b', 'scheduling', null],
      ],
    },
  ])('changed: $change → exactly its calls', ({ from, to, calls }) => {
    const started = startOver(from);
    started.calls.length = 0;

    started.runRows.changed(to);

    expect(started.calls).toEqual(calls);
  });

  it('changed runRows: the new section claims the new rows', () => {
    const started = startOver(schedulingState(['a'], []));

    started.runRows.changed(schedulingState(['a', 'c'], []));

    const [section] = started.liveSections();
    expect(started.liveSections()).toHaveLength(1);
    expect(
      ['a', 'b', 'c'].map((id) => section!.claims(sessionRow(id))),
    ).toEqual([true, false, true]);
  });

  it('the first state marks every unviewed row, in order', () => {
    const started = startOver(schedulingState(['a', 'b'], ['a', 'b']));

    expect(
      started.calls.filter(([method]) => method === 'setActivity'),
    ).toEqual([
      ['setActivity', 'a', 'scheduling', SCHEDULED_RUN_DONE],
      ['setActivity', 'b', 'scheduling', SCHEDULED_RUN_DONE],
    ]);
    expect(started.logs).toEqual([
      'run rows: 2',
      'run row done: a',
      'run row done: b',
    ]);
  });

  it('dispose clears every mark and the section', () => {
    const started = startOver(schedulingState(['a', 'b'], ['b']));
    started.calls.length = 0;

    started.runRows.dispose();

    expect(started.calls).toEqual([
      ['setActivity', 'b', 'scheduling', null],
      ['disposeSection', 'scheduling'],
    ]);
    expect(started.liveSections()).toHaveLength(0);
  });
});
