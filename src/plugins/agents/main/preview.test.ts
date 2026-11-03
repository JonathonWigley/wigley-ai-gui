import { describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../sessions/contract';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Roster } from '../contract';
import { createAgentsPreview } from './preview';

const NOW = 900_000;

// A preview over sessions whose `open` hands out rows `row-1`, `row-2`, …;
// `rosters` holds each `rosterChanged` sent, `ends` each row whose owned
// session ended.
function setUp() {
  const opened: [SessionInfo, unknown][] = [];
  const ends: string[] = [];
  const rosters: { sessionId: string; roster: Roster }[] = [];
  const activate = vi.fn<(sessionId: string) => void>();
  const preview = createAgentsPreview({
    sessions: {
      open(info, options) {
        opened.push([info, options]);
        const id = `row-${opened.length}`;
        return {
          session: { id } as never,
          end: () => ends.push(id),
          setHostSessionId: () => undefined,
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
    const sample = rosters[0].roster;
    expect(sample.agents.map((agent) => agent.startedAt)).toEqual([
      NOW - 42_000,
      NOW - 185_000,
    ]);
    expect(
      sample.agents.map(
        ({ name, model, effort, spendUsd, tools, outcome }) => ({
          name,
          model,
          effort,
          spendUsd,
          tools: tools.map((tool) => `${tool.tool} ${tool.outcome}`),
          outcome,
        }),
      ),
    ).toEqual([
      {
        name: 'map-sessions',
        model: 'claude-sonnet-5-5',
        effort: 'medium',
        spendUsd: 0.0421,
        tools: ['Read running'],
        outcome: 'running',
      },
      {
        name: 'Explore',
        model: 'claude-haiku-5-5',
        effort: null,
        spendUsd: 0.0187,
        tools: [
          ...Array.from({ length: 11 }, (_, i) =>
            i % 2 === 0 ? 'Grep done' : 'Read done',
          ),
          'Read running',
        ],
        outcome: 'running',
      },
    ]);
    expect(
      sample.tasks.map(({ agentId, command, outcome }) => ({
        agentId,
        command,
        outcome,
      })),
    ).toEqual([
      {
        agentId: MAIN_AGENT_ID,
        command: 'npm run selftest',
        outcome: 'running',
      },
      {
        agentId: sample.agents[1].agentId,
        command:
          'npm run test -- --watch src/main/claude-code/stream-decoder.test.ts',
        outcome: 'running',
      },
    ]);
    expect(afterOpen).toEqual({
      ends: [],
      rosters: { 'row-1': sample },
    });
    expect(ends).toEqual(['row-1']);
    expect(rosters[1]).toEqual({
      sessionId: 'row-1',
      roster: { agents: [], tasks: [] },
    });
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
