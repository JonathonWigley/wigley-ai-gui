import { describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../sessions/contract';
import type { RunningAgent } from '../contract';
import { createAgentsPreview } from './preview';

const NOW = 900_000;

// A preview over sessions whose `open` hands out rows `row-1`, `row-2`, …;
// `rosters` holds each `rosterChanged` sent, `ends` each row whose owned
// session ended.
function setUp() {
  const opened: [SessionInfo, unknown][] = [];
  const ends: string[] = [];
  const rosters: { sessionId: string; running: RunningAgent[] }[] = [];
  const activate = vi.fn<(sessionId: string) => void>();
  const preview = createAgentsPreview({
    sessions: {
      open(info, options) {
        opened.push([info, options]);
        const id = `row-${opened.length}`;
        return {
          session: { id } as never,
          end: () => ends.push(id),
        };
      },
      activate,
    },
    clock: { now: () => NOW },
    send: (message, data) => {
      if (message === 'rosterChanged') {
        rosters.push(data);
      }
    },
    log: () => undefined,
  });
  return { preview, opened, ends, rosters, activate };
}

describe('agents preview', () => {
  it('toggle_Twice_OpensSampleThenEndsRow', () => {
    const { preview, opened, ends, rosters, activate } = setUp();

    preview.toggle();
    const afterOpen = { ends: [...ends], rosters: preview.rosters() };
    preview.toggle();

    expect(opened).toEqual([
      [
        expect.objectContaining({ sessionId: 'agents-layout-preview' }),
        { select: true },
      ],
    ]);
    expect(activate).toHaveBeenCalledWith('row-1');
    expect(rosters[0].sessionId).toBe('row-1');
    expect(rosters[0].running.map((agent) => agent.startedAt)).toEqual([
      NOW - 42_000,
      NOW - 185_000,
    ]);
    expect(afterOpen).toEqual({
      ends: [],
      rosters: { 'row-1': rosters[0].running },
    });
    expect(ends).toEqual(['row-1']);
    expect(rosters[1]).toEqual({ sessionId: 'row-1', running: [] });
    expect(preview.rosters()).toEqual({});
  });

  it('closed_PreviewRow_NextToggleOpensAgain', () => {
    const { preview, opened, ends } = setUp();
    preview.toggle();

    preview.closed('other-row');
    const afterOther = [...ends];
    preview.closed('row-1');
    preview.toggle();

    expect(afterOther).toEqual([]);
    expect(ends).toEqual(['row-1']);
    expect(opened).toHaveLength(2);
    expect(Object.keys(preview.rosters())).toEqual(['row-2']);
  });
});
