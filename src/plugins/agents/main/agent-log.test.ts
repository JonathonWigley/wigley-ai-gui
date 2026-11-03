import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID, type AgentEvent } from '../../../contracts/agent';
import { createMemoryFiles } from '../../../shared/memory-files';
import { createAgentLog } from './agent-log';

const e1: AgentEvent = { type: 'userMessage', at: 1 };
const e2: AgentEvent = {
  type: 'agentSpawned',
  at: 2,
  agentId: 'toolu_a',
  parentAgentId: MAIN_AGENT_ID,
  agentType: 'Explore',
  description: 'Find adapters',
  name: 'Explore',
  model: null,
  effort: null,
};

// A `files` double whose appends each wait for the test to settle them.
function setUpHeldFiles() {
  const calls: { path: string; text: string }[] = [];
  const settles: { resolve(): void; reject(error: Error): void }[] = [];
  const logged: string[] = [];
  const files = {
    append(path: string, text: string) {
      calls.push({ path, text });
      return new Promise<void>((resolve, reject) => {
        settles.push({ resolve, reject });
      });
    },
  };
  const agentLog = createAgentLog({
    files,
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  return { calls, settles, logged, agentLog };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createAgentLog', () => {
  it('append_TwoEvents_WritesOneJsonLineEach', async () => {
    const files = createMemoryFiles();
    const agentLog = createAgentLog({ files, log: () => {} });

    await Promise.all([agentLog.append('h1', e1), agentLog.append('h1', e2)]);

    expect(await files.read('logs/h1.jsonl')).toBe(
      JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n',
    );
  });

  it('append_SecondBeforeFirstSettles_StartsInCallOrder', async () => {
    const test = setUpHeldFiles();

    void test.agentLog.append('h1', e1);
    void test.agentLog.append('h1', e2);
    await flush();
    expect(test.calls).toEqual([
      { path: 'logs/h1.jsonl', text: JSON.stringify(e1) + '\n' },
    ]);

    test.settles[0].resolve();
    await flush();
    expect(test.calls).toEqual([
      { path: 'logs/h1.jsonl', text: JSON.stringify(e1) + '\n' },
      { path: 'logs/h1.jsonl', text: JSON.stringify(e2) + '\n' },
    ]);
  });

  it('append_FirstFails_LogsAndWritesSecond', async () => {
    const test = setUpHeldFiles();

    const first = test.agentLog.append('h1', e1);
    const second = test.agentLog.append('h1', e2);
    await flush();
    test.settles[0].reject(new Error('disk full'));
    await flush();
    test.settles[1].resolve();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(test.logged).toEqual([
      '[agents] event not logged to logs/h1.jsonl: disk full',
    ]);
    expect(test.calls.map((call) => call.text)).toEqual([
      JSON.stringify(e1) + '\n',
      JSON.stringify(e2) + '\n',
    ]);
  });
});
