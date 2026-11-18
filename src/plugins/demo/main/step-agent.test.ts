import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { ScopedAgentRecord } from '../../scoped-agents/contract';
import type { DemoRunState, DemoStepBrief } from '../contract';
import { createStepAgentStore, stepAgentInstructions } from './step-agent';

const FILE = 'step-agents.json';
const UNREADABLE = 'step-agents.json unreadable; the step agents start fresh';
const ONE: ScopedAgentRecord = { sessionId: 'row-1', hostSessionId: 'h-1' };
const TWO: ScopedAgentRecord = { sessionId: 'row-2', hostSessionId: 'h-2' };

const BRIEF: DemoStepBrief = {
  id: 'p.one',
  plugin: 'p',
  title: 'The first feature',
  caption: 'Shows the first feature.',
  files: ['src/plugins/p/page/view.ts', 'src/plugins/p/main/start.ts'],
  beats: ['working', 'finished'],
};

function runState(fields: Partial<DemoRunState>): DemoRunState {
  return {
    running: true,
    stepId: 'p.one',
    beat: 0,
    autoplay: false,
    realShown: false,
    ...fields,
  };
}

// A store over memory plugin data holding `text` in step-agents.json (no
// file when null); `logged` holds each log line.
async function storeOver(text: string | null) {
  const data = createMemoryFiles();
  if (text !== null) {
    await data.write(FILE, text);
  }
  const logged: string[] = [];
  const store = createStepAgentStore(data, (line) => logged.push(line));
  return { store, logged };
}

describe('createStepAgentStore', () => {
  it('store_WriteReadEntries_RoundTrips', async () => {
    const { store } = await storeOver(null);

    await store.write('p.one', ONE);
    await store.write('p.two', TWO);

    expect(await store.read('p.one')).toEqual(ONE);
    expect(await store.read('p.three')).toBeNull();
    expect(await store.entries()).toEqual([
      { scope: 'p.one', record: ONE },
      { scope: 'p.two', record: TWO },
    ]);

    await store.write('p.one', null);

    expect(await store.read('p.one')).toBeNull();
    expect(await store.entries()).toEqual([{ scope: 'p.two', record: TWO }]);
  });

  it.each([
    { name: 'not JSON', text: '{' },
    {
      name: 'a record of the wrong shape',
      text: '{ "p.one": { "sessionId": 1, "hostSessionId": "h" } }',
    },
  ])('store_FileUnreadable_EmptyAndLoggedOnce ($name)', async ({ text }) => {
    const { store, logged } = await storeOver(text);

    const entries = await store.entries();

    expect(entries).toEqual([]);
    expect(logged).toEqual([UNREADABLE]);
  });
});

const CLONE = { path: '/clone', isAppClone: true };

describe('stepAgentInstructions', () => {
  it('stepAgentInstructions_BriefAndRun_NamesStepFilesBeatAndFolder', () => {
    const run = runState({ stepId: 'p.one', beat: 1 });

    const text = stepAgentInstructions('p.one', BRIEF, run, CLONE);
    const briefless = stepAgentInstructions('p.one', undefined, run, CLONE);

    expect(text).toContain('step p.one of the p plugin: The first feature.');
    expect(text).toContain('- src/plugins/p/page/view.ts\n');
    expect(text).toContain('- src/plugins/p/main/start.ts\n');
    expect(text).toContain('beat 2 of step p.one');
    expect(text).toContain('/clone');
    expect(briefless).toContain(
      'You are the step agent of the wigley-ai-gui demo for step p.one.\n',
    );
  });

  it.each([
    { name: 'no run state', run: undefined },
    {
      name: 'no step on screen',
      run: runState({ running: false, stepId: null }),
    },
  ])(
    'stepAgentInstructions_NoStepOnScreen_LeavesOutTheStartedLine ($name)',
    ({ run }) => {
      const text = stepAgentInstructions('p.one', BRIEF, run, CLONE);

      expect(text).not.toContain('When this conversation started');
    },
  );

  // Breaks: an agent started in the home folder told it works in the app's clone.
  it.each([
    {
      name: 'clone',
      folder: CLONE,
      says: "You work in the app's own clone, /clone.",
    },
    {
      name: 'home',
      folder: { path: '/home', isAppClone: false },
      says: 'You start in /home: the app found no clone of its own.',
    },
  ])(
    'stepAgentInstructions_Folder_NamesWhereTheAgentWorks ($name)',
    ({ folder, says }) => {
      const text = stepAgentInstructions('p.one', BRIEF, undefined, folder);

      expect(text).toContain(says);
      expect(text.includes("app's own clone")).toBe(folder.isAppClone);
    },
  );
});
