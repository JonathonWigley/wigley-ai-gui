import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  CHECKLIST_STAGE,
  CHECKLIST_WORKFLOW_ID,
  type SessionFlow,
  workflowFlowsSlot,
} from '../contract';
import { newFlow } from '../flow';
import { createFlowStore, FLOWS_FILE, type FlowStore } from './flow-store';

const SAVED_H1: SessionFlow = {
  ...newFlow('s-old', '/r'),
  workflow: 'small',
  movedUpFrom: null,
  stage: 'build',
  checklist: [{ text: 'a', done: true }],
  turnRunning: true,
  runningSubagents: ['a1'],
};

const NOW = 50_000;

function flowsFile(
  entries: { hostSessionId: string; flow: SessionFlow; savedAt?: unknown }[],
) {
  return JSON.stringify({ flows: entries });
}

// A flow store over memory files holding `text` as flows.json (none when
// null), and a real slot already holding `leftover`, its clock reading `time.now`;
// `logs` records each logged line and `slot` reads the slot.
async function loadStore(
  text: string | null,
  leftover: Record<string, SessionFlow> = {},
) {
  const files = createMemoryFiles();
  if (text !== null) {
    await files.write(FLOWS_FILE, text);
  }
  const logs: string[] = [];
  const time = { now: NOW };
  const flows = createSlotStore(() => undefined).publish(workflowFlowsSlot);
  for (const [sessionId, flow] of Object.entries(leftover)) {
    flows.set(sessionId, flow);
  }
  const store = createFlowStore({
    flows,
    files,
    log: (line) => logs.push(line),
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
  const slot = () => Object.fromEntries(flows.all());
  return { store, logs, saved, slot, time };
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

  it.each<{ name: string; flow: Record<string, unknown> }>([
    { name: 'a workflow not a string', flow: { ...SAVED_H1, workflow: 7 } },
    {
      name: 'a movedUpFrom not a string',
      flow: { ...SAVED_H1, movedUpFrom: 7 },
    },
    {
      name: 'a checklist item of the wrong shape',
      flow: { ...SAVED_H1, checklist: [{ text: 1, done: true }] },
    },
    {
      name: 'an unclaimedWork not a boolean',
      flow: { ...SAVED_H1, unclaimedWork: 'x' },
    },
    {
      name: 'the old shape',
      flow: {
        sessionId: 's-old',
        projectDir: '/r',
        stage: 'make',
        planDir: null,
        progress: null,
        countdownEndsAt: null,
        turnRunning: false,
        runningSubagents: [],
      },
    },
  ])('Load_InvalidFlow_DropsAll ($name)', async ({ flow }) => {
    const { store, logs } = await loadStore(
      JSON.stringify({ flows: [{ hostSessionId: 'h1', flow }] }),
    );

    expect(store.open('s9', 'h1', '/r')).toEqual(newFlow('s9', '/r'));
    expect(logs).toEqual(['flows.json unreadable; starting with no flows']);
  });

  it.each<{ name: string; flow: SessionFlow }>([
    { name: 'a workflow and its checklist', flow: SAVED_H1 },
    {
      name: 'the declared-workflow fields',
      flow: {
        ...SAVED_H1,
        checklistReported: true,
        counters: { fix: 2 },
        enteredFrom: 'review',
        countdownEndsAt: 9_000,
      },
    },
    {
      name: 'a field an older app saved',
      flow: { ...SAVED_H1, hasLeftIdle: true } as SessionFlow,
    },
  ])('Load_ValidFlow_RoundTrips ($name)', async ({ flow }) => {
    const { store } = await loadStore(
      flowsFile([{ hostSessionId: 'h1', flow }]),
    );

    expect(store.open('s9', 'h1', '/r')).toStrictEqual({
      ...flow,
      sessionId: 's9',
      turnRunning: false,
      runningSubagents: [],
    });
    expect(store.hostIdOf('s9')).toBe('h1');
    store.rekey('s9', 'h2');
    expect(store.hostIdOf('s9')).toBe('h2');
  });

  it.each<{
    name: string;
    flow: Record<string, unknown>;
    expected: Partial<SessionFlow>;
  }>([
    {
      name: 'a saved flow with no declared-workflow fields takes their defaults',
      flow: (({
        checklistReported: _reported,
        plan: _plan,
        counters: _counters,
        enteredFrom: _enteredFrom,
        countdownEndsAt: _endsAt,
        ...rest
      }) => rest)(SAVED_H1),
      expected: {
        workflow: 'small',
        stage: 'build',
        checklistReported: false,
        plan: null,
        counters: {},
        enteredFrom: null,
        countdownEndsAt: null,
      },
    },
    {
      name: 'a saved workflow null loads on the Checklist flow',
      flow: { ...SAVED_H1, workflow: null, stage: 'build' },
      expected: { workflow: CHECKLIST_WORKFLOW_ID, stage: CHECKLIST_STAGE },
    },
  ])('Load_OlderFlow_Upgrades ($name)', async ({ flow, expected }) => {
    const { store, logs } = await loadStore(
      JSON.stringify({ flows: [{ hostSessionId: 'h1', flow }] }),
    );

    expect(store.open('s9', 'h1', '/r')).toMatchObject(expected);
    expect(logs).toEqual([]);
  });

  // A run partway through a workflow: a stage, a move up and counters.
  const MID_RUN: SessionFlow = {
    ...SAVED_H1,
    movedUpFrom: 'x:small',
    checklistReported: true,
    counters: { fix: 2 },
  };

  // Breaks if a retired level id reopens on a workflow nothing registers, or if
  // an id a plugin may register again (a refused `auri.json`, a plugin briefly
  // uninstalled) loses its run.
  it.each<{ name: string; workflow: string; keepsRun: boolean }>([
    { name: 'a retired level id', workflow: 'workflow-large', keepsRun: false },
    {
      name: 'an unregistered plugin id',
      workflow: 'gone:large',
      keepsRun: true,
    },
  ])('Open_SavedWorkflow ($name)', async ({ workflow, keepsRun }) => {
    const flow = { ...MID_RUN, workflow };
    const { store } = await loadStore(
      flowsFile([{ hostSessionId: 'h1', flow }]),
    );

    expect(store.open('s9', 'h1', '/r')).toStrictEqual(
      keepsRun
        ? { ...flow, sessionId: 's9', turnRunning: false, runningSubagents: [] }
        : {
            ...newFlow('s9', '/r'),
            checklist: flow.checklist,
            checklistReported: true,
          },
    );
  });

  it('Load_SavedMissedLevel_LoadsWithoutIt', async () => {
    const { store } = await loadStore(
      flowsFile([
        {
          hostSessionId: 'h1',
          flow: { ...SAVED_H1, missedLevel: true } as SessionFlow,
        },
      ]),
    );

    expect(store.open('s9', 'h1', '/r')).toStrictEqual({
      ...SAVED_H1,
      sessionId: 's9',
      turnRunning: false,
      runningSubagents: [],
    });
  });

  it('Load_SavedState_LoadsWithoutIt', async () => {
    const { store, logs } = await loadStore(
      flowsFile([
        {
          hostSessionId: 'h1',
          flow: { ...SAVED_H1, state: { planDir: '/p' } } as SessionFlow,
        },
      ]),
    );

    expect(store.open('s9', 'h1', '/r')).toStrictEqual({
      ...SAVED_H1,
      sessionId: 's9',
      turnRunning: false,
      runningSubagents: [],
    });
    expect(logs).toEqual([]);
  });

  it('putRekeyDrop_EachWritesTheEntries_KeepingUnopenedOnes', async () => {
    const unopened = { ...newFlow('s-x', '/q'), stage: 'feature' };
    const { store, saved } = await loadStore(
      flowsFile([{ hostSessionId: 'h-x', flow: unopened }]),
    );
    const opened = store.open('s1', 'h1', '/r');
    const made = { ...opened, stage: 'make' };

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

  // What the file gives a session that opens on host h1.
  const RESTORED_S9: SessionFlow = {
    ...SAVED_H1,
    sessionId: 's9',
    turnRunning: false,
    runningSubagents: [],
  };
  const STALE: SessionFlow = { ...newFlow('s9', '/r'), stage: 'review' };

  it.each<{
    name: string;
    leftover?: Record<string, SessionFlow>;
    act: (store: FlowStore) => void;
    slot: Record<string, SessionFlow>;
    all: string[];
    savedHosts: string[];
  }>([
    {
      name: 'open_RestoresFromTheFile',
      act: (store) => store.open('s9', 'h1', '/r'),
      slot: { s9: RESTORED_S9 },
      all: ['s9'],
      savedHosts: ['h1'],
    },
    {
      name: 'a leftover key at creation is deleted',
      leftover: { s9: STALE },
      act: () => undefined,
      slot: {},
      all: [],
      savedHosts: ['h1'],
    },
    {
      name: 'a leftover key gives way to the file at the open',
      leftover: { s9: STALE },
      act: (store) => store.open('s9', 'h1', '/r'),
      slot: { s9: RESTORED_S9 },
      all: ['s9'],
      savedHosts: ['h1'],
    },
    {
      name: 'drop deletes the key and the saved entry',
      act: (store) => {
        store.open('s9', 'h1', '/r');
        store.drop('s9');
      },
      slot: {},
      all: [],
      savedHosts: [],
    },
    {
      name: 'a reopen after a drop restores no stale flow',
      act: (store) => {
        store.open('s9', 'h1', '/r');
        store.drop('s9');
        store.open('s9', 'h1', '/r');
      },
      slot: { s9: newFlow('s9', '/r') },
      all: ['s9'],
      savedHosts: ['h1'],
    },
    {
      name: 'all keeps open order through a put',
      act: (store) => {
        store.open('s2', 'h2', '/r');
        const first = store.open('s9', 'h1', '/r');
        store.put({ ...first, stage: 'make' });
        store.put({ ...store.get('s2')!, stage: 'make' });
      },
      slot: {
        s2: { ...newFlow('s2', '/r'), stage: 'make' },
        s9: { ...RESTORED_S9, stage: 'make' },
      },
      all: ['s2', 's9'],
      savedHosts: ['h1', 'h2'],
    },
  ])('slot_$name', async ({ leftover, act, slot, all, savedHosts }) => {
    const {
      store,
      saved,
      slot: readSlot,
    } = await loadStore(
      flowsFile([{ hostSessionId: 'h1', flow: SAVED_H1 }]),
      leftover,
    );

    act(store);

    expect(readSlot()).toEqual(slot);
    expect(store.all().map(({ sessionId }) => sessionId)).toEqual(all);
    expect((await saved()).flows.map((entry) => entry.hostSessionId)).toEqual(
      savedHosts,
    );
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
