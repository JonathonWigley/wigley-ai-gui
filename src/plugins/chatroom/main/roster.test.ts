import { describe, expect, it } from 'vitest';
import type { AgentSession, SessionTitles } from '../../sessions/contract';
import type { Participant } from '../contract';
import { createRoster, type Roster } from './roster';

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

interface FakeSessions {
  projects: Record<string, string | null>;
  titles: Record<string, SessionTitles>;
  labels: Record<string, string>;
}

function rosterOver(fake: Partial<FakeSessions> = {}): Roster {
  const { projects = {}, titles = {}, labels = {} } = fake;
  return createRoster({
    sessions: {
      project: (rowId) => projects[rowId] ?? null,
      titles: (rowId) => titles[rowId] ?? null,
      label: (rowId) => labels[rowId] ?? null,
    },
  });
}

function agentSession(
  id: string,
  hostSessionId: string | null = null,
): AgentSession {
  return {
    id,
    info: {
      sessionId: hostSessionId,
      projectDir: `/r/${id}`,
      harness: 'claude',
      rowId: null,
    },
  };
}

function mainAgent(rowId: string, name: string): Participant {
  return { kind: 'agent', rowId, agentId: null, mirrorId: null, name };
}

describe('roster', () => {
  it('directory_ListsMainAgentsWithARoom', () => {
    const roster = rosterOver({
      projects: { r1: 'a', r2: 'b', r3: 'a', r4: null },
      titles: {
        r1: { ...NO_TITLES, agent: 'One' },
        r3: { ...NO_TITLES, agent: 'Three' },
      },
    });
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      roster.connected(agentSession(id));
    }
    roster.subagentSpawned('r1', 'agent-7', 'worker');

    expect(roster.directory()).toEqual([
      { room: 'a', participant: mainAgent('r1', 'One') },
      { room: 'b', participant: mainAgent('r2', 'session r2') },
      { room: 'a', participant: mainAgent('r3', 'Three') },
    ]);
  });

  type NameRow = {
    case: string;
    titles: SessionTitles | null;
    label: string | null;
    agentId: string | null;
    steps: (roster: Roster) => void;
    expected: string;
  };
  const titled: SessionTitles = { ...NO_TITLES, agent: 'Title' };
  it.each<NameRow>([
    {
      case: 'main agent with an agent title',
      titles: titled,
      label: 'gamma 2',
      agentId: null,
      steps: () => undefined,
      expected: 'Title',
    },
    {
      case: 'no title, the label',
      titles: NO_TITLES,
      label: 'gamma 2',
      agentId: null,
      steps: () => undefined,
      expected: 'gamma 2',
    },
    {
      case: 'no label',
      titles: null,
      label: null,
      agentId: null,
      steps: () => undefined,
      expected: 'session r1',
    },
    {
      case: 'subagent seen spawning',
      titles: titled,
      label: null,
      agentId: 'agent-7',
      steps: (roster) => roster.subagentSpawned('r1', 'agent-7', 'worker'),
      expected: 'Title ▸ worker',
    },
    {
      case: 'subagent never seen',
      titles: titled,
      label: null,
      agentId: 'agent-7',
      steps: () => undefined,
      expected: 'Title ▸ subagent',
    },
    {
      case: 'subagent after subagentFinished',
      titles: titled,
      label: null,
      agentId: 'agent-7',
      steps: (roster) => {
        roster.subagentSpawned('r1', 'agent-7', 'worker');
        roster.subagentFinished('r1', 'agent-7');
      },
      expected: 'Title ▸ subagent',
    },
    {
      case: 'the same id spawned again as tester',
      titles: titled,
      label: null,
      agentId: 'agent-7',
      steps: (roster) => {
        roster.subagentSpawned('r1', 'agent-7', 'worker');
        roster.subagentSpawned('r1', 'agent-7', 'tester');
      },
      expected: 'Title ▸ tester',
    },
  ])(
    'participant_Names: $case',
    ({ titles, label, agentId, steps, expected }) => {
      const roster = rosterOver({
        projects: { r1: 'a' },
        titles: titles === null ? {} : { r1: titles },
        labels: label === null ? {} : { r1: label },
      });
      roster.connected(agentSession('r1'));
      steps(roster);

      expect(roster.participant('r1', agentId)).toEqual({
        kind: 'agent',
        rowId: 'r1',
        agentId,
        mirrorId: null,
        name: expected,
      });
    },
  );

  it('sessions_Lifecycle', () => {
    const roster = rosterOver({ projects: { r1: 'a' } });

    roster.connected(agentSession('r1', 'host-1'));
    expect(roster.sessions()).toEqual([
      {
        rowId: 'r1',
        harness: 'claude',
        folder: '/r/r1',
        hostSessionId: 'host-1',
      },
    ]);

    roster.connected(agentSession('r1', 'host-other'));
    expect(roster.sessions()).toEqual([
      expect.objectContaining({ hostSessionId: 'host-1' }),
    ]);

    roster.hostSessionChanged(agentSession('r1', 'host-2'));
    expect(roster.sessions()).toEqual([
      expect.objectContaining({ rowId: 'r1', hostSessionId: 'host-2' }),
    ]);

    roster.ended('r1');
    expect(roster.has('r1')).toBe(false);
    expect(roster.sessions()).toEqual([]);
    expect(roster.directory()).toEqual([]);
  });
});
