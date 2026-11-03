import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { createFlowStore, FLOWS_FILE, type FlowStore } from './flow-store';

const SAVED_H1: SessionFlow = {
  ...newFlow('s-old', '/r'),
  stage: 'make',
  planDir: '/r/plan-a',
  turnRunning: true,
  runningSubagents: ['a1'],
  countdownEndsAt: 9_000,
  hasLeftIdle: true,
};

const NOW = 50_000;

function flowsFile(
  entries: { hostSessionId: string; flow: SessionFlow; savedAt?: unknown }[],
) {
  return JSON.stringify({ flows: entries });
}

// A flow store over memory files holding `text` as flows.json (none when
// null), its clock reading `time.now`; `logs` records each logged line.
async function loadStore(text: string | null) {
  const files = createMemoryFiles();
  if (text !== null) {
    await files.write(FLOWS_FILE, text);
  }
  const logs: string[] = [];
  const time = { now: NOW };
  const store = createFlowStore({
    files,
    log: (_source, line) => logs.push(line),
    paths: posixPaths,
    clock: { now: () => time.now },
  });
  await store.load();
  const saved = async () => {
    await new Promise((settle) => setImmediate(settle));
    return JSON.parse(await files.read(FLOWS_FILE)) as {
      flows: { hostSessionId: string; flow: SessionFlow }[];
    };
  };
  return { store, logs, saved, time };
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
    {
      name: 'a reviewRoundsAtMake not a number',
      text: JSON.stringify({
        flows: [
          {
            hostSessionId: 'h1',
            flow: { ...SAVED_H1, reviewRoundsAtMake: '2' },
          },
        ],
      }),
      logged: 1,
    },
    {
      name: 'a savedAt not a number',
      text: flowsFile([{ hostSessionId: 'h1', flow: SAVED_H1, savedAt: '7' }]),
      logged: 1,
    },
  ])('load: $name gives no saved flows', async ({ text, logged }) => {
    const { store, logs } = await loadStore(text);

    expect(store.all()).toEqual([]);
    expect(store.open('s9', 'h1', '/r')).toEqual(newFlow('s9', '/r'));
    expect(logs).toHaveLength(logged);
  });

  it.each<{ name: string; flow: SessionFlow }>([
    { name: 'no reviewRoundsAtMake', flow: SAVED_H1 },
    {
      name: 'reviewRoundsAtMake 2',
      flow: { ...SAVED_H1, reviewRoundsAtMake: 2 },
    },
    {
      name: 'reviewRoundsAtMake null',
      flow: { ...SAVED_H1, reviewRoundsAtMake: null },
    },
  ])(
    'load_SavedFlowWith_$name_OpensAsSavedWithNoTurnSubagentOrCountdown',
    async ({ flow }) => {
      const { store } = await loadStore(
        flowsFile([{ hostSessionId: 'h1', flow }]),
      );

      expect(store.open('s9', 'h1', '/r')).toStrictEqual({
        ...flow,
        sessionId: 's9',
        turnRunning: false,
        runningSubagents: [],
        countdownEndsAt: null,
      });
      expect(store.hostIdOf('s9')).toBe('h1');
      store.rekey('s9', 'h2');
      expect(store.hostIdOf('s9')).toBe('h2');
    },
  );

  it('putRekeyDrop_EachWritesTheEntries_KeepingUnopenedOnes', async () => {
    const unopened = { ...newFlow('s-x', '/q'), stage: 'feature' };
    const { store, saved } = await loadStore(
      flowsFile([{ hostSessionId: 'h-x', flow: unopened }]),
    );
    const opened = store.open('s1', 'h1', '/r');
    const made = { ...opened, stage: 'make', hasLeftIdle: true };

    store.put(made);
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened, savedAt: NOW },
      { hostSessionId: 'h1', flow: made, savedAt: NOW },
    ]);

    store.rekey('s1', 'h2');
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened, savedAt: NOW },
      { hostSessionId: 'h2', flow: made, savedAt: NOW },
    ]);

    store.drop('s1');
    expect((await saved()).flows).toEqual([
      { hostSessionId: 'h-x', flow: unopened, savedAt: NOW },
    ]);
    expect(store.get('s1')).toBeNull();
  });

  it.each<{
    name: string;
    entrySavedAt: number | undefined;
    act: (store: FlowStore) => void;
    expected: number;
  }>([
    {
      name: 'an entry with its time, through open and rekey',
      entrySavedAt: 700,
      act: (store) => store.rekey('s9', 'h2'),
      expected: 700,
    },
    {
      name: 'an entry with no time, read as the load',
      entrySavedAt: undefined,
      act: () => undefined,
      expected: NOW,
    },
    {
      name: 'a change that keeps the time',
      entrySavedAt: 700,
      act: (store) =>
        store.putKeepingSavedAt({ ...SAVED_H1, sessionId: 's9', stage: 'x' }),
      expected: 700,
    },
    {
      name: 'a put, stamped with the clock',
      entrySavedAt: 700,
      act: (store) => store.put({ ...SAVED_H1, sessionId: 's9', stage: 'x' }),
      expected: NOW + 5,
    },
  ])(
    'savedAtOf_And_TheFile_Hold_$name',
    async ({ entrySavedAt, act, expected }) => {
      const { store, saved, time } = await loadStore(
        flowsFile([
          { hostSessionId: 'h1', flow: SAVED_H1, savedAt: entrySavedAt },
        ]),
      );
      store.open('s9', 'h1', '/r');
      time.now += 5;

      act(store);

      expect(store.savedAtOf('s9')).toBe(expected);
      expect((await saved()).flows[0]).toMatchObject({ savedAt: expected });
    },
  );

  it('savedAtOf_NewFlow_IsZero_SoAReplayFoldsWhole', async () => {
    const { store } = await loadStore(null);

    store.open('s1', 'h1', '/r');

    expect(store.savedAtOf('s1')).toBe(0);
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
      { hostSessionId: 'h-y', flow: unopenedQ, savedAt: NOW },
      { hostSessionId: 'h2', flow: inQ, savedAt: NOW },
    ]);
  });
});
