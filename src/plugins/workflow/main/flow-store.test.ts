import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { createFlowStore, FLOWS_FILE } from './flow-store';

const SAVED_H1: SessionFlow = {
  ...newFlow('s-old', '/r'),
  stage: 'make',
  planDir: '/r/plan-a',
  turnRunning: true,
  runningSubagents: ['a1'],
  countdownEndsAt: 9_000,
  hasLeftIdle: true,
};

function flowsFile(entries: { hostSessionId: string; flow: SessionFlow }[]) {
  return JSON.stringify({ flows: entries });
}

// A flow store over memory files holding `text` as flows.json (none when
// null); `logs` records each logged line.
async function loadStore(text: string | null) {
  const files = createMemoryFiles();
  if (text !== null) {
    await files.write(FLOWS_FILE, text);
  }
  const logs: string[] = [];
  const store = createFlowStore({
    files,
    log: (_source, line) => logs.push(line),
    paths: posixPaths,
  });
  await store.load();
  const saved = async () => {
    await new Promise((settle) => setImmediate(settle));
    return JSON.parse(await files.read(FLOWS_FILE)) as {
      flows: { hostSessionId: string; flow: SessionFlow }[];
    };
  };
  return { store, logs, saved };
}

describe('createFlowStore', () => {
  it.each([
    { name: 'missing file', text: null, logged: 0 },
    { name: 'not JSON', text: '{ flows', logged: 1 },
    {
      name: 'wrong shape',
      text: JSON.stringify({
        flows: [{ hostSessionId: 'h1', flow: { ...SAVED_H1, stage: 3 } }],
      }),
      logged: 1,
    },
  ])('load: $name gives no saved flows', async ({ text, logged }) => {
    const { store, logs } = await loadStore(text);

    expect(store.all()).toEqual([]);
    expect(store.open('s9', 'h1', '/r')).toEqual(newFlow('s9', '/r'));
    expect(logs).toHaveLength(logged);
  });

  it('load_SavedFlow_OpensWithNoTurnSubagentOrCountdown', async () => {
    const { store } = await loadStore(
      flowsFile([{ hostSessionId: 'h1', flow: SAVED_H1 }]),
    );

    expect(store.open('s9', 'h1', '/r')).toEqual({
      ...SAVED_H1,
      sessionId: 's9',
      turnRunning: false,
      runningSubagents: [],
      countdownEndsAt: null,
    });
    expect(store.hostIdOf('s9')).toBe('h1');
    store.rekey('s9', 'h2');
    expect(store.hostIdOf('s9')).toBe('h2');
  });

  it('putRekeyDrop_EachWritesTheEntries_KeepingUnopenedOnes', async () => {
    const unopened = { ...newFlow('s-x', '/q'), stage: 'feature' };
    const { store, saved } = await loadStore(
      flowsFile([{ hostSessionId: 'h-x', flow: unopened }]),
    );
    const opened = store.open('s1', 'h1', '/r');
    const made = { ...opened, stage: 'make', hasLeftIdle: true };

    store.put(made);
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened },
      { hostSessionId: 'h1', flow: made },
    ]);

    store.rekey('s1', 'h2');
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened },
      { hostSessionId: 'h2', flow: made },
    ]);

    store.drop('s1');
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened },
    ]);
    expect(store.get('s1')).toBeNull();
  });

  it('forgetFlows_ForgetsOpenAndSavedFlowsInTheFolder_KeepsOthers', async () => {
    const unopenedR = { ...newFlow('s-x', '/r'), stage: 'feature' };
    const unopenedQ = { ...newFlow('s-y', '/q'), stage: 'feature' };
    const { store, saved } = await loadStore(
      flowsFile([
        { hostSessionId: 'h-x', flow: unopenedR },
        { hostSessionId: 'h-y', flow: unopenedQ },
      ]),
    );
    store.open('s1', 'h1', '/r');
    const inQ = { ...store.open('s2', 'h2', '/q'), stage: 'make' };
    store.open('s3', 'h3', '/r');
    store.put(inQ);

    const forgotten = store.forgetFlows('/r/');

    expect(forgotten).toEqual(['s1', 's3']);
    expect(store.all()).toEqual([inQ]);
    expect(store.get('s1')).toBeNull();
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-y', flow: unopenedQ },
      { hostSessionId: 'h2', flow: inQ },
    ]);
  });
});
