import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import type { ChatAgentEvent } from '../../chat/contract';
import type { Participant } from '../contract';
import type { EntryRequest, RoomService } from './room-service';
import { createAgentEntries } from './agent-entries';
import { createRoster } from './roster';

const SPAWNED: AgentEvent = {
  type: 'agentSpawned',
  at: 1,
  agentId: 'agent-2',
  parentAgentId: 'main',
  agentType: 'worker',
  description: 'Fix the shop',
  name: 'shop-fixer',
  model: null,
  effort: null,
};

function chatEvent(
  event: AgentEvent,
  fields: Partial<ChatAgentEvent> = {},
): ChatAgentEvent {
  return {
    sessionId: 'rA',
    profileDir: null,
    hostSessionId: 'host-a',
    event,
    replayed: false,
    ...fields,
  };
}

function entriesOver(
  addEntry: RoomService['addEntry'] = async () => ({}) as never,
) {
  const roster = createRoster({
    sessions: {
      project: (rowId) => (rowId === 'rA' ? 'game' : null),
      titles: () => ({ user: null, agent: 'Lead', firstMessage: null }),
      label: () => null,
    },
  });
  for (const id of ['rA', 'rZ']) {
    roster.connected(
      {
        id,
        info: {
          sessionId: null,
          projectDir: null,
          harness: 'claude',
          rowId: null,
        },
      },
      true,
    );
  }
  roster.subagentSpawned('rA', 'agent-1', 'planner');
  const room = { addEntry: vi.fn(addEntry) };
  const touches = { fromAgentEvent: vi.fn() };
  const logs: string[] = [];
  const entries = createAgentEntries({
    room,
    roster,
    touches,
    log: (line) => logs.push(line),
  });
  return { entries, room, touches, logs };
}

function agent(agentId: string | null, name: string): Participant {
  return { kind: 'agent', rowId: 'rA', agentId, mirrorId: null, name };
}

describe('createAgentEntries', () => {
  it.each<{ case: string; events: ChatAgentEvent[]; expected: EntryRequest[] }>(
    [
      {
        case: 'spawned',
        events: [chatEvent(SPAWNED)],
        expected: [
          {
            room: 'game',
            thread: 'session:rA',
            from: agent(null, 'Lead'),
            kind: 'dispatch',
            body: 'dispatched shop-fixer (worker): Fix the shop',
            refs: [],
          },
        ],
      },
      {
        case: 'spawned by a subagent',
        events: [chatEvent({ ...SPAWNED, parentAgentId: 'agent-1' })],
        expected: [
          expect.objectContaining({
            kind: 'dispatch',
            from: agent('agent-1', 'Lead ▸ planner'),
          }),
        ],
      },
      {
        case: 'finished',
        events: [
          chatEvent(SPAWNED),
          chatEvent({
            type: 'agentFinished',
            at: 2,
            agentId: 'agent-2',
            outcome: 'failed',
          }),
        ],
        expected: [
          expect.objectContaining({ kind: 'dispatch' }),
          {
            room: 'game',
            thread: 'session:rA',
            from: agent('agent-2', 'Lead ▸ worker'),
            kind: 'hand-back',
            body: 'handed back (failed)',
            refs: [],
          },
        ],
      },
      {
        case: 'replayed',
        events: [chatEvent(SPAWNED, { replayed: true })],
        expected: [],
      },
      {
        case: 'row with no room',
        events: [chatEvent(SPAWNED, { sessionId: 'rZ' })],
        expected: [],
      },
    ],
  )('entries_FromAgentEvents: $case', ({ events, expected }) => {
    const { entries, room } = entriesOver();

    for (const event of events) {
      entries.heard(event);
    }

    expect(room.addEntry.mock.calls.map(([entry]) => entry)).toEqual(expected);
  });

  it('entries_FromAgentEvents: every event reaches the touch tracker, replayed included', () => {
    const { entries, touches } = entriesOver();
    const written = chatEvent(
      { type: 'fileWritten', at: 3, agentId: 'main', path: '/r/a.ts' },
      { replayed: true },
    );

    entries.heard(written);

    expect(touches.fromAgentEvent).toHaveBeenCalledWith(written);
  });

  it('entries_FromAgentEvents: a rejected addEntry is logged', async () => {
    const { entries, logs } = entriesOver(async () => {
      throw new Error('EIO');
    });

    expect(() => entries.heard(chatEvent(SPAWNED))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logs).toEqual(['entry not saved: EIO']);
  });
});
