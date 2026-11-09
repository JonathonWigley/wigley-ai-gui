import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlotStore } from '../../../shared/state/slot-store';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type JudgeResult,
  type OpenedProblem,
  type PracticePlace,
  type ProblemSummary,
  practicePlaceSlot,
} from '../contract';
import { AUTOSAVE_DELAY_MS } from './problem-workspace';
import { practicePagePart } from './start';

// Two problems, listed out of their sorted order: `easy` sorts first.
const HARD: ProblemSummary = {
  slug: 'hard-one',
  title: 'Hard One',
  difficulty: 'hard',
  tags: [],
  lists: [],
  status: 'new',
  due: false,
};
const EASY: ProblemSummary = {
  ...HARD,
  slug: 'easy-one',
  title: 'Easy One',
  difficulty: 'easy',
};
const SECOND = HARD.slug;

function opened(summary: ProblemSummary): OpenedProblem {
  return {
    summary,
    statement: '',
    signature: {
      kind: 'function',
      method: 'solve',
      params: [],
      returns: 'int',
    },
    code: '',
    notes: '',
    customCases: '',
    attempt: {
      id: 'a1',
      started: '2026-01-01T00:00:00Z',
      peeked: false,
      interviewer: null,
    },
    submissions: [],
  };
}

const ACCEPTED: JudgeResult = {
  verdict: 'accepted',
  passed: 2,
  total: 2,
  ms: 5,
  compileOutput: null,
  failing: null,
  cases: [],
};

// A Practice page whose `list` reads both problems, whose `open` opens the
// slug asked for and whose judge accepts; `calls` holds each invoke, `place`
// the last page's place, `editors` the code editor and boxes it made.
function startPracticePage(place?: PracticePlace) {
  installFocusFakeDom(vi.stubGlobal);
  const editors = countingEditors();
  const calls: { method: string; args: unknown[] }[] = [];
  const state = createSlotStore(() => undefined);
  if (place !== undefined) {
    const oldPage = state.publish(practicePlaceSlot);
    oldPage.set(place);
    oldPage.dispose();
  }
  const harness = startPagePart(practicePagePart, {
    firstModeTaken: true,
    state,
    services: {
      editor: editors.host,
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
    },
    invoke: async (method, ...args) => {
      calls.push({ method, args });
      if (method === 'list') {
        return [HARD, EASY];
      }
      if (method === 'open') {
        return opened(args[0] === EASY.slug ? EASY : HARD);
      }
      if (method === 'run' || method === 'submit') {
        return ACCEPTED;
      }
      if (method === 'peek') {
        return { approach: 'Hash it.', reference: 'int solve();' };
      }
      return undefined;
    },
  });
  return { harness, calls, editors };
}

// A Practice page, shown, with `SECOND` open in the workspace.
async function startWithProblemOpen() {
  const page = startPracticePage();
  const commands = page.harness.started().commands;
  commands.showMode({ arg: undefined });
  await settle();
  commands.listDown({ arg: undefined });
  commands.openProblem({ arg: undefined });
  await settle();
  return { ...page, commands };
}

const methodsOf = (calls: readonly { method: string }[]) =>
  calls.map((call) => call.method);

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const messagesOf = (harness: ReturnType<typeof startPracticePage>['harness']) =>
  harness.logs.map((line) => line.message);

describe('practicePagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the selected problem on openProblem', async () => {
    const { harness, calls } = startPracticePage();
    await settle();
    const commands = harness.started().commands;

    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();

    expect(calls).toContainEqual({ method: 'open', args: [SECOND] });
    expect(messagesOf(harness)).toContain(`opened ${SECOND}`);
  });

  it('reads the list again on changed', async () => {
    const { harness, calls } = startPracticePage();
    await settle();
    harness.started().commands.listDown({ arg: undefined });

    harness.send('changed', { slug: null });
    await settle();

    expect(calls.filter((call) => call.method === 'list')).toHaveLength(2);
    expect(harness.state.read(practicePlaceSlot, 'test').get()).toMatchObject({
      selectedSlug: SECOND,
    });
  });

  it('restores the place', async () => {
    const { harness } = startPracticePage({
      selectedSlug: SECOND,
      openSlug: SECOND,
      filter: '',
      pane: 'problem',
      problemTab: 'description',
      consoleTab: 'testcase',
    });
    await settle();
    await settle();

    expect(messagesOf(harness)).toEqual(
      expect.arrayContaining([`selected ${SECOND}`, `opened ${SECOND}`]),
    );
  });

  it('opens a picked problem on its problem pane', async () => {
    const { harness } = await startWithProblemOpen();

    expect(harness.scope()).toBe('practice.problem');
    expect(messagesOf(harness)).toContain('problem focused');
  });

  it.each<{ command: 'run' | 'submit' }>([
    { command: 'run' },
    { command: 'submit' },
  ])('saves the typed code before a $command', async ({ command }) => {
    const { harness, calls, editors, commands } = await startWithProblemOpen();
    editors.typeDocument('int solve() { return 1; }');
    calls.length = 0;

    commands[command]({ arg: undefined });
    await settle();

    expect(calls.slice(0, 2)).toEqual([
      { method: 'saveCode', args: [SECOND, 'int solve() { return 1; }'] },
      { method: command, args: [SECOND] },
    ]);
    expect(messagesOf(harness)).toEqual(
      expect.arrayContaining([
        `${command} started ${SECOND}`,
        `${command} ${SECOND}: accepted 2/2`,
      ]),
    );
  });

  it('reads the problem again after a submit', async () => {
    const { harness, calls, commands } = await startWithProblemOpen();
    calls.length = 0;

    commands.submit({ arg: undefined });
    await settle();
    await settle();

    expect(methodsOf(calls)).toEqual(['submit', 'open']);
    expect(messagesOf(harness)).toContain(`submit ${SECOND}: accepted 2/2`);
  });

  it('autosaves the code once typing pauses', async () => {
    const { harness, calls, editors } = await startWithProblemOpen();
    editors.typeDocument('int solve');
    harness.advance(100);
    editors.typeDocument('int solve();');

    harness.advance(AUTOSAVE_DELAY_MS - 1);
    const isSavedEarly = methodsOf(calls).includes('saveCode');
    harness.advance(1);
    await settle();

    expect(isSavedEarly).toBe(false);
    expect(calls.filter((call) => call.method === 'saveCode')).toEqual([
      { method: 'saveCode', args: [SECOND, 'int solve();'] },
    ]);
    expect(messagesOf(harness)).toContain('saved code');
  });

  it.each<{
    answer: 'confirmYes' | 'confirmNo';
    peeks: number;
    isPeekLogged: boolean;
  }>([
    { answer: 'confirmNo', peeks: 0, isPeekLogged: false },
    { answer: 'confirmYes', peeks: 1, isPeekLogged: true },
  ])(
    'asks before the solution: $answer',
    async ({ answer, peeks, isPeekLogged }) => {
      const { harness, calls, commands } = await startWithProblemOpen();

      commands.showTab({ arg: 'solution' });
      const isPeekedBeforeAnswer = methodsOf(calls).includes('peek');
      commands[answer]({ arg: undefined });
      await settle();

      expect(isPeekedBeforeAnswer).toBe(false);
      expect(messagesOf(harness)).toContain('solution confirm asked');
      expect(
        methodsOf(calls).filter((method) => method === 'peek'),
      ).toHaveLength(peeks);
      expect(messagesOf(harness).includes(`peeked ${SECOND}`)).toBe(
        isPeekLogged,
      );
    },
  );
});
