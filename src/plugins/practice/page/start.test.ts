import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlotStore } from '../../../shared/state/slot-store';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  type FakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  countingEditors,
  deferred,
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type AgentPane,
  type AgentPaneSpec,
  scopedAgentsPageKey,
} from '../../scoped-agents/contract';
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

function opened(summary: ProblemSummary, attemptId = 'a1'): OpenedProblem {
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
      id: attemptId,
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

// What a test answers an invoke with in place of the page's own answer;
// undefined leaves it to the page.
type HeldAnswer = (
  method: string,
  args: unknown[],
) => Promise<unknown> | undefined;

// The interviewer's pane scoped-agents hands Practice: `spec` the spec it
// got, `calls` each call Practice made on it. It shows only once toggled, and
// its outer panes take every move.
interface FakePane {
  spec: AgentPaneSpec | null;
  calls: string[];
}

function fakeAgentPane(pane: FakePane): AgentPane {
  let isPaneShown = false;
  return {
    element: document.createElement('div'),
    isShown: () => isPaneShown,
    toggle() {
      pane.calls.push('toggle');
      isPaneShown = !isPaneShown;
    },
    scopeOpened(scope) {
      pane.calls.push(`scopeOpened ${String(scope)}`);
    },
    refresh: () => undefined,
    hostTookKeys() {
      pane.calls.push('hostTookKeys');
    },
    modeHidden() {
      pane.calls.push('modeHidden');
    },
    outerPanes: {
      focus: {
        move(direction) {
          pane.calls.push(`move ${direction}`);
          return true;
        },
      },
      resize: { nudge: () => true },
    },
    redraw: () => undefined,
    dispose() {
      pane.calls.push('dispose');
    },
  };
}

// A Practice page whose `list` reads both problems, whose `open` opens the
// slug asked for and whose judge accepts, unless `held` answers first; `calls`
// holds each invoke, `place` the last page's place, `editors` the code editor
// and boxes it made, `pane` the interviewer's fake pane.
function startPracticePage(place?: PracticePlace, held?: HeldAnswer) {
  installFocusFakeDom(vi.stubGlobal);
  const editors = countingEditors();
  const calls: { method: string; args: unknown[] }[] = [];
  const pane: FakePane = { spec: null, calls: [] };
  const state = createSlotStore(() => undefined);
  if (place !== undefined) {
    const oldPage = state.publish(practicePlaceSlot);
    oldPage.set(place);
    oldPage.dispose();
  }
  const harness = startPagePart(practicePagePart, {
    firstModeTaken: true,
    state,
    dependencies: [
      fakeDependency(scopedAgentsPageKey, () => ({
        addAgentPane(spec) {
          pane.spec = spec;
          return fakeAgentPane(pane);
        },
      })),
    ],
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
      const answer = held?.(method, args);
      if (answer !== undefined) {
        return answer;
      }
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
  return { harness, calls, editors, pane };
}

// A Practice page, shown, with `SECOND` open in the workspace.
async function startWithProblemOpen(held?: HeldAnswer) {
  const page = startPracticePage(undefined, held);
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

const placeOf = (harness: ReturnType<typeof startPracticePage>['harness']) =>
  harness.state.read(practicePlaceSlot, 'test').get();

// Focuses `target` as a click does, its `focusin` reaching it and each
// element over it.
function focusIn(target: FakeElement) {
  (target as unknown as { focus(): void }).focus();
  for (let node: FakeElement | null = target; node; node = node.parentNode) {
    node.fire('focusin', { target });
  }
}

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

  it('keeps the shown problem and its code when the code fails to save', async () => {
    const { harness, editors, commands } = await startWithProblemOpen(
      (method) =>
        method === 'saveCode'
          ? Promise.reject(new Error('disk full'))
          : undefined,
    );
    editors.typeDocument('int solve();');
    const made = editors.made();

    commands.listUp({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    await settle();

    expect(editors.made()).toBe(made);
    expect(placeOf(harness)).toMatchObject({
      openSlug: SECOND,
      selectedSlug: SECOND,
    });
    expect(messagesOf(harness)).toEqual(
      expect.arrayContaining([
        `kept ${SECOND}: a draft did not save`,
        `toast error: ${EASY.title} not opened: a draft did not save`,
      ]),
    );
  });

  it('saves the code typed during the save before showing another problem', async () => {
    const firstSave = deferred<undefined>();
    let saves = 0;
    const { harness, calls, editors, commands } = await startWithProblemOpen(
      (method) =>
        method === 'saveCode' && ++saves === 1 ? firstSave.promise : undefined,
    );
    editors.typeDocument('int solve');

    commands.listUp({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    editors.typeDocument('int solve();');
    firstSave.resolve(undefined);
    await settle();
    await settle();

    expect(
      calls
        .filter((call) => call.method === 'saveCode')
        .map((call) => call.args),
    ).toEqual([
      [SECOND, 'int solve'],
      [SECOND, 'int solve();'],
    ]);
    expect(placeOf(harness)).toMatchObject({ openSlug: EASY.slug });
  });

  it('keeps the edits typed while a switch waits when the shown problem is picked again', async () => {
    const firstSave = deferred<undefined>();
    let saves = 0;
    const { harness, calls, editors, commands } = await startWithProblemOpen(
      (method) =>
        method === 'saveCode' && ++saves === 1 ? firstSave.promise : undefined,
    );
    const made = editors.made();
    editors.typeDocument('int solve');
    commands.listUp({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    editors.typeDocument('int solve();');

    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    firstSave.resolve(undefined);
    await settle();
    harness.advance(AUTOSAVE_DELAY_MS);
    await settle();

    expect(editors.made()).toBe(made);
    expect(
      calls
        .filter((call) => call.method === 'saveCode')
        .map((call) => call.args),
    ).toEqual([
      [SECOND, 'int solve'],
      [SECOND, 'int solve();'],
    ]);
    expect(placeOf(harness)).toMatchObject({ openSlug: SECOND });
  });

  it('drops a submit landing after another problem opened', async () => {
    const submitted = deferred<JudgeResult>();
    const { harness, editors, commands } = await startWithProblemOpen(
      (method) => (method === 'submit' ? submitted.promise : undefined),
    );
    commands.submit({ arg: undefined });
    await settle();
    commands.listUp({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    await settle();
    const made = editors.made();

    submitted.resolve(ACCEPTED);
    await settle();
    await settle();

    expect(editors.made()).toBe(made);
    expect(placeOf(harness)).toMatchObject({ openSlug: EASY.slug });
  });

  it('hands the keys to the problem column on a click into it', async () => {
    const { harness } = startPracticePage();
    const commands = harness.started().commands;
    commands.showMode({ arg: undefined });
    await settle();
    commands.openKeepingFocus({ arg: undefined });
    await settle();
    await settle();
    const scopeBefore = harness.scope();

    const body = asFake(harness.mode('practice.main').element).querySelector(
      '.practice-tab-body',
    );
    focusIn(body!);

    expect([scopeBefore, harness.scope()]).toEqual([
      'practice.list',
      'practice.problem',
    ]);
    expect(messagesOf(harness)).toContain('main focused');
  });

  it.each<{ case: string; reopenedAttempt: string | null; calls: string[] }>([
    {
      case: 'first open',
      reopenedAttempt: null,
      calls: ['scopeOpened null', `scopeOpened ${SECOND}`],
    },
    { case: 'the same attempt refreshed', reopenedAttempt: 'a1', calls: [] },
    {
      case: 'a fresh attempt of the same problem',
      reopenedAttempt: 'a2',
      calls: ['scopeOpened null', `scopeOpened ${SECOND}`],
    },
  ])(
    'hands the pane its scope per attempt: $case',
    async ({ reopenedAttempt, calls }) => {
      let attemptId = 'a1';
      const { harness, pane } = await startWithProblemOpen((method, args) =>
        method === 'open' && args[0] === SECOND
          ? Promise.resolve(opened(HARD, attemptId))
          : undefined,
      );
      if (reopenedAttempt !== null) {
        pane.calls.length = 0;
        attemptId = reopenedAttempt;
        harness.send('changed', { slug: SECOND });
        await settle();
        await settle();
      }

      expect(pane.calls).toEqual(calls);
      expect({
        owner: pane.spec?.owner,
        agentId: pane.spec?.agentId,
        hint: pane.spec?.hint,
        heading: pane.spec?.heading(),
      }).toEqual({
        owner: 'practice',
        agentId: 'interviewer',
        hint: 'Ask about the problem. The interviewer asks guiding questions and gives no answers.',
        heading: HARD.title,
      });
    },
  );

  it.each<{
    case: string;
    start: 'hidden' | 'shown' | 'open';
    refusals: string[];
    toggles: string[];
  }>([
    {
      case: 'no open problem',
      start: 'shown',
      refusals: [
        'toast info: Open a problem first',
        'interviewer needs an open problem',
      ],
      toggles: [],
    },
    {
      case: 'no open problem, Practice hidden',
      start: 'hidden',
      refusals: [
        'toast info: Open a problem first',
        'interviewer needs an open problem',
      ],
      toggles: [],
    },
    {
      case: 'a problem open',
      start: 'open',
      refusals: [],
      toggles: ['toggle'],
    },
  ])('toggleInterviewer: $case', async ({ start, refusals, toggles }) => {
    const { harness, pane } =
      start === 'open' ? await startWithProblemOpen() : startPracticePage();
    const commands = harness.started().commands;
    if (start === 'shown') {
      commands.showMode({ arg: undefined });
    }
    await settle();

    commands.toggleInterviewer({ arg: undefined });

    expect(
      messagesOf(harness).filter(
        (line) =>
          line.startsWith('toast') ||
          line === 'interviewer needs an open problem',
      ),
    ).toEqual(refusals);
    expect(pane.calls.filter((call) => call === 'toggle')).toEqual(toggles);
    expect(messagesOf(harness)).toContain('shown');
  });

  it('the outer panes take right only from main', async () => {
    const { harness, pane } = startPracticePage();
    const commands = harness.started().commands;
    commands.showMode({ arg: undefined });
    await settle();

    const fromList = harness.outerPanes()!.focus.move('right');
    const callsFromList = [...pane.calls];
    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    const fromMain = harness.outerPanes()!.focus.move('right');

    expect([fromList, callsFromList]).toEqual([false, []]);
    expect([fromMain, pane.calls.at(-1)]).toEqual([true, 'move right']);
  });

  it('run and submit do nothing while Practice is hidden', async () => {
    const { harness, calls } = startPracticePage();
    const commands = harness.started().commands;
    await settle();
    commands.listDown({ arg: undefined });
    commands.openKeepingFocus({ arg: undefined });
    await settle();
    await settle();
    calls.length = 0;

    commands.run({ arg: undefined });
    commands.submit({ arg: undefined });
    await settle();

    expect(calls).toEqual([]);
    expect(messagesOf(harness)).toEqual(
      expect.arrayContaining([
        'run ignored: practice hidden',
        'submit ignored: practice hidden',
      ]),
    );
  });

  it('stops with nothing live', async () => {
    const { harness } = await startWithProblemOpen();

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });
});
