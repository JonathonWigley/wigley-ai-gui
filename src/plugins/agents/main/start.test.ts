import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../../contracts/agent';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { SessionsMainExports } from '../../sessions/contract';
import type { RunningAgent } from '../contract';
import { agentsMainPart } from './start';

const PREVIEW_ROW = 'preview-row';

const spawned: AgentEvent = {
  type: 'agentSpawned',
  at: 1_000,
  agentId: 'toolu_a',
  parentAgentId: MAIN_AGENT_ID,
  agentType: 'Explore',
  description: 'Find adapters',
};
const finished: AgentEvent = {
  type: 'agentFinished',
  at: 2_000,
  agentId: 'toolu_a',
  outcome: 'done',
};
const userMessage: AgentEvent = { type: 'userMessage', at: 3_000 };

const runningA: RunningAgent = {
  agentId: 'toolu_a',
  agentType: 'Explore',
  description: 'Find adapters',
  startedAt: 1_000,
  toolCalls: 0,
};

// Agents' main part started over a fake `MainApi` whose plugin data is a
// memory `Files`; `emit` calls the listeners of a qualified event, `sent`
// records every `rosterChanged` and `invoke` calls a handled channel method.
// Sessions' `open` hands back a row `PREVIEW_ROW`, so `openPreview` opens the
// preview there.
function startAgentsPart() {
  const handlers = new Map<string, () => unknown>();
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  const sent: { sessionId: string; running: RunningAgent[] }[] = [];
  const data = createMemoryFiles();
  const sessions: Pick<SessionsMainExports, 'open' | 'activate'> = {
    open: (info) => ({
      session: { id: PREVIEW_ROW, info },
      end: () => undefined,
    }),
    activate: () => undefined,
  };
  const api = {
    channel: {
      handle: (name: string, handler: () => unknown) =>
        handlers.set(name, handler),
      send: (
        name: string,
        message: { sessionId: string; running: RunningAgent[] },
      ) => {
        if (name === 'rosterChanged') {
          sent.push(message);
        }
      },
    },
    events: {
      emit: () => undefined,
      on: (event: string, listener: (data: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    data,
    services: {
      log: () => undefined,
      clock: { now: () => 50_000 },
      selfTest: null,
    },
    dependency: (pluginId: string) => (pluginId === 'sessions' ? sessions : {}),
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof agentsMainPart.start>[0];
  agentsMainPart.start(api);
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  };
  const agentEvent = (event: AgentEvent) =>
    emit('chat.agentEvent', {
      sessionId: 's1',
      profileDir: null,
      hostSessionId: 'h1',
      event,
    });
  const invoke = (name: string) => handlers.get(name)?.();
  return { sent, data, emit, agentEvent, invoke };
}

const settled = () => new Promise((settle) => setImmediate(settle));

describe('agentsMainPart', () => {
  it.each([
    {
      name: 'an event that leaves the roster as it was sends nothing',
      steps: [spawned, userMessage],
      sent: [{ sessionId: 's1', running: [runningA] }],
      rosters: { s1: [runningA] },
    },
    {
      name: 'an emptied roster sends [] and is no longer listed',
      steps: [spawned, finished],
      sent: [
        { sessionId: 's1', running: [runningA] },
        { sessionId: 's1', running: [] },
      ],
      rosters: {},
    },
    {
      name: 'a closed then ended session sends [] once',
      steps: [spawned, 'sessions.closed', 'sessions.ended'],
      sent: [
        { sessionId: 's1', running: [runningA] },
        { sessionId: 's1', running: [] },
      ],
      rosters: {},
    },
    {
      name: 'an ended session with no roster sends nothing',
      steps: ['sessions.ended'],
      sent: [],
      rosters: {},
    },
  ])('$name', ({ steps, sent, rosters }) => {
    const agents = startAgentsPart();

    for (const step of steps) {
      if (typeof step === 'string') {
        agents.emit(step, { sessionId: 's1' });
      } else {
        agents.agentEvent(step);
      }
    }

    expect(agents.sent).toEqual(sent);
    expect(agents.invoke('rosters')).toEqual(rosters);
  });

  it('logs each event under its host session id', async () => {
    const agents = startAgentsPart();

    agents.agentEvent(spawned);
    agents.agentEvent(userMessage);
    await settled();

    expect(await agents.data.read('logs/h1.jsonl')).toBe(
      JSON.stringify(spawned) + '\n' + JSON.stringify(userMessage) + '\n',
    );
  });

  it('rosters copies each live list and merges the preview roster', () => {
    const agents = startAgentsPart();
    agents.agentEvent(spawned);
    agents.invoke('openPreview');

    const first = agents.invoke('rosters') as Record<string, RunningAgent[]>;
    first.s1.pop();
    first[PREVIEW_ROW].pop();
    const second = agents.invoke('rosters') as Record<string, RunningAgent[]>;

    expect(Object.keys(second)).toEqual(['s1', PREVIEW_ROW]);
    expect(second.s1).toEqual([runningA]);
    expect(second[PREVIEW_ROW]).toHaveLength(first[PREVIEW_ROW].length + 1);
  });
});
