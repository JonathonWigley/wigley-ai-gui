import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../contracts/agent';
import type { SessionFlow, WorkflowSignal } from '../contract';
import { newFlow } from '../flow';
import { signalOf } from './agent-signals';

const FLOW = newFlow('s1', '/r');

function running(...agentIds: string[]): SessionFlow {
  return { ...FLOW, turnRunning: true, runningSubagents: agentIds };
}

function skill(args: string, agentId = 'main'): AgentEvent {
  return {
    type: 'skillStarted',
    at: 1,
    agentId,
    skill: 'wigley:make',
    args,
  };
}

const ROWS: {
  name: string;
  event: AgentEvent;
  flow: SessionFlow;
  fromCurrentHost: boolean;
  expected: WorkflowSignal[];
}[] = [
  {
    name: 'main skillStarted with an absolute path keeps it',
    event: skill('/a/plan-x'),
    flow: FLOW,
    fromCurrentHost: true,
    expected: [
      {
        type: 'skillStarted',
        skill: 'wigley:make',
        args: '/a/plan-x',
        argsPath: '/a/plan-x',
      },
    ],
  },
  {
    name: 'a relative path resolves against the project folder',
    event: skill('docs/features/x/plan-a'),
    flow: FLOW,
    fromCurrentHost: true,
    expected: [
      {
        type: 'skillStarted',
        skill: 'wigley:make',
        args: 'docs/features/x/plan-a',
        argsPath: '/r/docs/features/x/plan-a',
      },
    ],
  },
  {
    name: 'text args keep args and resolve argsPath as a path',
    event: skill('two words'),
    flow: FLOW,
    fromCurrentHost: true,
    expected: [
      {
        type: 'skillStarted',
        skill: 'wigley:make',
        args: 'two words',
        argsPath: '/r/two words',
      },
    ],
  },
  {
    name: 'empty args give a null argsPath',
    event: skill(''),
    flow: FLOW,
    fromCurrentHost: true,
    expected: [
      { type: 'skillStarted', skill: 'wigley:make', args: '', argsPath: null },
    ],
  },
  {
    name: "a subagent's skillStarted gives nothing",
    event: skill('/a/plan-x', 'a1'),
    flow: FLOW,
    fromCurrentHost: true,
    expected: [],
  },
  {
    name: "a subagent's fileWritten gives nothing",
    event: { type: 'fileWritten', at: 1, agentId: 'a1', path: '/r/x.md' },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [],
  },
  {
    name: 'main fileWritten gives its path',
    event: { type: 'fileWritten', at: 1, agentId: 'main', path: '/r/x.md' },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [{ type: 'fileWritten', path: '/r/x.md' }],
  },
  {
    name: 'turnStarted',
    event: { type: 'turnStarted', at: 1 },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [{ type: 'turnStarted' }],
  },
  {
    name: 'turnEnded',
    event: { type: 'turnEnded', at: 1 },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [{ type: 'turnEnded' }],
  },
  {
    name: 'userMessage gives nothing',
    event: { type: 'userMessage', at: 1 },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [],
  },
  {
    name: 'agentSpawned by main starts a subagent',
    event: {
      type: 'agentSpawned',
      at: 1,
      agentId: 'a1',
      parentAgentId: 'main',
      agentType: 'worker',
      description: 'd',
      name: 'worker',
      model: null,
      effort: null,
    },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [{ type: 'subagentStarted', agentId: 'a1' }],
  },
  {
    name: "a subagent's own agentSpawned gives nothing",
    event: {
      type: 'agentSpawned',
      at: 1,
      agentId: 'a2',
      parentAgentId: 'a1',
      agentType: 'worker',
      description: 'd',
      name: 'worker',
      model: null,
      effort: null,
    },
    flow: running('a1'),
    fromCurrentHost: true,
    expected: [],
  },
  {
    name: 'agentFinished of a running subagent finishes it',
    event: { type: 'agentFinished', at: 1, agentId: 'a1', outcome: 'done' },
    flow: running('a1'),
    fromCurrentHost: true,
    expected: [{ type: 'subagentFinished', agentId: 'a1' }],
  },
  {
    name: 'agentFinished of an id not running gives nothing',
    event: { type: 'agentFinished', at: 1, agentId: 'a1', outcome: 'done' },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [],
  },
  {
    name: 'sessionEnded from the current host ends subagents, then the turn',
    event: { type: 'sessionEnded', at: 1 },
    flow: running('a1', 'a2'),
    fromCurrentHost: true,
    expected: [
      { type: 'subagentFinished', agentId: 'a1' },
      { type: 'subagentFinished', agentId: 'a2' },
      { type: 'turnEnded' },
    ],
  },
  {
    name: 'sessionEnded from an earlier host gives nothing',
    event: { type: 'sessionEnded', at: 1 },
    flow: running('a1', 'a2'),
    fromCurrentHost: false,
    expected: [],
  },
  {
    name: 'toolStarted gives nothing',
    event: {
      type: 'toolStarted',
      at: 1,
      agentId: 'main',
      toolUseId: 't1',
      tool: 'Read',
      summary: '',
    },
    flow: FLOW,
    fromCurrentHost: true,
    expected: [],
  },
];

describe('signalOf', () => {
  it.each(ROWS)('$name', ({ event, flow, fromCurrentHost, expected }) => {
    expect(signalOf(event, flow, fromCurrentHost)).toEqual(expected);
  });
});
