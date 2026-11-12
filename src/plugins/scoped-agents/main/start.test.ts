import { describe, expect, it, vi } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type ChatMainExports,
  chatMainKey,
  type LaunchRequest,
} from '../../chat/contract';
import type {
  ScopedAgentRecord,
  ScopedAgentSpec,
  ScopedAgentsMainExports,
} from '../contract';
import { scopedAgentsMainPart } from './start';

// A store over a map that keeps each write, in order.
function memoryStore() {
  const records = new Map<string, ScopedAgentRecord>();
  const writes: { scope: string; record: ScopedAgentRecord | null }[] = [];
  const store: ScopedAgentSpec['store'] = {
    read: async (scope) => records.get(scope) ?? null,
    async write(scope, record) {
      writes.push({ scope, record });
      if (record === null) {
        records.delete(scope);
      } else {
        records.set(scope, record);
      }
    },
    entries: async () =>
      [...records].map(([scope, record]) => ({ scope, record })),
    superseded: async () => null,
    checkAsk: async () => undefined,
  };
  return { store, writes };
}

function specOf(
  owner: string,
  agentId: string,
  store: ScopedAgentSpec['store'],
): ScopedAgentSpec {
  return {
    owner,
    agentId,
    folder: (scope) => `/work/${scope}`,
    instructions: async () => 'Be terse.',
    title: async (scope) => `Agent: ${scope}`,
    store,
  };
}

// The scoped-agents main part over the harness, chat faked: `launch` resolves
// `row-1` and holds no row. `exportsFor` is the exports a consumer gets.
function startScopedAgents() {
  const launches: LaunchRequest[] = [];
  const chat = {
    async launch(request: LaunchRequest) {
      launches.push(request);
      return 'row-1';
    },
    defaultProfile: () => 'default',
    profileOf: () => null,
  } as unknown as ChatMainExports;
  const harness = startMainPart(scopedAgentsMainPart, {
    dependencies: [fakeDependency(chatMainKey, () => chat)],
  });
  const exportsFor = (consumer: ReturnType<typeof createRegistrations>) =>
    harness.started().exports?.(consumer) as ScopedAgentsMainExports;
  return Object.assign(harness, { launches, exportsFor });
}

describe('scoped-agents main part', () => {
  it('chat session events reach the service once', async () => {
    const harness = startScopedAgents();
    const consumer = createRegistrations();
    const interviewer = memoryStore();
    const assistant = memoryStore();
    harness
      .exportsFor(consumer)
      .addScopedAgent(specOf('practice', 'interviewer', interviewer.store));
    harness
      .exportsFor(consumer)
      .addScopedAgent(specOf('backlog', 'assistant', assistant.store));

    const asking = harness.invoke('ask', 'practice', 'interviewer', 's', 'hi');
    await vi.waitFor(() => expect(harness.launches).toHaveLength(1));
    harness.emit('chat.sessionOpened', {
      sessionId: 'row-1',
      profileDir: '~/.claude',
      hostSessionId: 'host-1',
      projectDir: '/work/s',
      profile: 'default',
      origin: 'launched',
    });
    expect(await asking).toBe('row-1');
    harness.emit('chat.sessionCleared', {
      sessionId: 'row-1',
      oldHostSessionId: 'host-1',
      newHostSessionId: 'host-2',
      projectDir: '/work/s',
      profile: 'default',
      titles: {},
      sent: false,
    });

    await vi.waitFor(() =>
      expect(interviewer.writes).toEqual([
        {
          scope: 's',
          record: { sessionId: 'row-1', hostSessionId: 'host-1' },
        },
        {
          scope: 's',
          record: { sessionId: 'row-1', hostSessionId: 'host-2' },
        },
      ]),
    );
    expect(assistant.writes).toEqual([]);
  });

  it('a registration ends with its consumer', async () => {
    const harness = startScopedAgents();
    const consumer = createRegistrations();
    harness
      .exportsFor(consumer)
      .addScopedAgent(specOf('practice', 'interviewer', memoryStore().store));

    consumer.dispose();

    await expect(
      harness.invoke('ask', 'practice', 'interviewer', 's', 'hi'),
    ).rejects.toThrow('No scoped agent practice/interviewer.');
  });
});
