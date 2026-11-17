import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import { createSlotStore } from '../../../shared/state/slot-store';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  type FocusFakeDocument,
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
import defaultLayout from '../layouts/default/layout.js';
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
// got, `calls` each call Practice made on it. Its outer panes take every move.
interface FakePane {
  spec: AgentPaneSpec | null;
  calls: string[];
}

function fakeAgentPane(pane: FakePane): AgentPane {
  return {
    element: document.createElement('div'),
    isShown: () => true,
    toggle() {
      pane.calls.push('toggle');
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

// One editor the page made for a text box: the frame it was made in, the text
// it was made with, and whether it was destroyed.
interface BoxEditor {
  frame: FakeElement;
  doc: string;
  isDestroyed: boolean;
}

// `editors`' host, recording each box editor it makes in `boxEditors` and
// each focus of one in `boxFocuses`; a box editor's focus and blur move the
// fake DOM focus to and from its frame, as a real editor's content does.
function recordingHost(
  editors: ReturnType<typeof countingEditors>,
  boxEditors: BoxEditor[],
  boxFocuses: BoxEditor[],
): EditorHost {
  return {
    ...editors.host,
    create(parent, doc, events) {
      const editor = editors.host.create(parent, doc, events);
      const made: BoxEditor = {
        frame: asFake(parent),
        doc,
        isDestroyed: false,
      };
      boxEditors.push(made);
      return {
        ...editor,
        focus(options) {
          boxFocuses.push(made);
          asFocusable(made.frame).focus();
          editor.focus(options);
        },
        blur() {
          asFocusable(made.frame).blur();
          editor.blur();
        },
        destroy() {
          made.isDestroyed = true;
          editor.destroy();
        },
      };
    },
  };
}

// The editors made for box `id`, in the order they were made.
function editorsOf(boxEditors: readonly BoxEditor[], id: string): BoxEditor[] {
  return boxEditors.filter((made) =>
    made.frame.classList.contains(`practice-box--${id}`),
  );
}

// A Practice page whose `list` reads both problems, whose `open` opens the
// slug asked for and whose judge accepts, unless `held` answers first; `calls`
// holds each invoke, `place` the last page's place, `editors` the code editor
// and boxes it made, `boxEditors` each box editor and `boxFocuses` each focus
// of one, `pane` the interviewer's fake pane.
function startPracticePage(place?: PracticePlace, held?: HeldAnswer) {
  installFocusFakeDom(vi.stubGlobal);
  const editors = countingEditors();
  const boxEditors: BoxEditor[] = [];
  const boxFocuses: BoxEditor[] = [];
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
      editor: recordingHost(editors, boxEditors, boxFocuses),
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
  return { harness, calls, editors, boxEditors, boxFocuses, pane };
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

const asFocusable = (target: FakeElement) =>
  target as unknown as { focus(): void; blur(): void };

// The fake document's focused element.
const focusedElement = () =>
  (document as unknown as FocusFakeDocument).activeElement;

// Focuses `target` as a click does, its `focusin` reaching it and each
// element over it.
function focusIn(target: FakeElement) {
  asFocusable(target).focus();
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

      expect(
        pane.calls.filter((call) => call.startsWith('scopeOpened')),
      ).toEqual(calls);
    },
  );

  it('registers the interviewer pane always shown under the console, with its owner, agent, hint and heading', async () => {
    const { pane } = await startWithProblemOpen();

    expect({
      owner: pane.spec?.owner,
      agentId: pane.spec?.agentId,
      hint: pane.spec?.hint,
      heading: pane.spec?.heading(),
      isAlwaysShown: pane.spec?.isAlwaysShown,
      entersFrom: pane.spec?.entersFrom,
    }).toEqual({
      owner: 'practice',
      agentId: 'interviewer',
      hint: 'Ask about the problem. The interviewer asks guiding questions and gives no answers.',
      heading: HARD.title,
      isAlwaysShown: true,
      entersFrom: 'down',
    });
  });

  // The list holds the keys after an open that keeps focus; each row acts on
  // the page, with the pane's spec callbacks Practice owns driven as the pane
  // drives them.
  it.each<{
    case: string;
    act: (page: ReturnType<typeof startPracticePage>) => void;
    hostCalls: string[];
    scope: string;
    isOuterPanesSet: boolean;
  }>([
    {
      case: 'focus leaves the interviewer for the column',
      act: ({ harness, pane }) => {
        pane.spec!.tookKeys();
        const body = asFake(
          harness.mode('practice.main').element,
        ).querySelector('.practice-tab-body');
        focusIn(body!);
      },
      hostCalls: ['hostTookKeys'],
      scope: 'practice.problem',
      isOuterPanesSet: true,
    },
    {
      case: 'leave while the interviewer holds the keys',
      act: ({ pane }) => {
        pane.spec!.tookKeys();
        pane.spec!.leave();
      },
      hostCalls: ['hostTookKeys'],
      scope: 'practice.problem',
      isOuterPanesSet: true,
    },
    {
      case: 'leave while the list holds the keys',
      act: ({ pane }) => pane.spec!.leave(),
      hostCalls: [],
      scope: 'practice.problem',
      isOuterPanesSet: true,
    },
    {
      case: 'Practice hidden',
      act: ({ harness }) => harness.mode('practice.main').hidden(),
      hostCalls: ['modeHidden'],
      scope: 'practice.list',
      isOuterPanesSet: false,
    },
    {
      case: 'layouts set while the interviewer holds the keys',
      act: ({ harness, pane }) => {
        pane.spec!.tookKeys();
        harness.showLayouts(
          withUser(defaultLayout, defaultLayout) as Parameters<
            typeof harness.showLayouts
          >[0],
        );
      },
      hostCalls: [],
      scope: 'practice.list',
      isOuterPanesSet: true,
    },
  ])(
    'the pane hands the keys to the page: $case',
    async ({ act, hostCalls, scope, isOuterPanesSet }) => {
      const page = startPracticePage();
      const commands = page.harness.started().commands;
      commands.showMode({ arg: undefined });
      await settle();
      commands.openKeepingFocus({ arg: undefined });
      await settle();
      await settle();
      page.pane.calls.length = 0;

      act(page);

      expect(
        page.pane.calls.filter(
          (call) => call === 'hostTookKeys' || call === 'modeHidden',
        ),
      ).toEqual(hostCalls);
      expect(page.harness.scope()).toBe(scope);
      expect(page.harness.outerPanes() !== null).toBe(isOuterPanesSet);
    },
  );

  it.each<{
    case: string;
    start: 'shown' | 'open' | 'holding';
    refusals: string[];
    toggles: string[];
  }>([
    {
      case: 'the interviewer holds the keys, no open problem',
      start: 'holding',
      refusals: [],
      toggles: ['toggle'],
    },
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
      case: 'a problem open',
      start: 'open',
      refusals: [],
      toggles: ['toggle'],
    },
  ])('toggleInterviewer: $case', async ({ start, refusals, toggles }) => {
    const { harness, pane } =
      start === 'open' ? await startWithProblemOpen() : startPracticePage();
    const commands = harness.started().commands;
    if (start === 'shown' || start === 'holding') {
      commands.showMode({ arg: undefined });
    }
    await settle();
    if (start === 'holding') {
      pane.spec!.tookKeys();
    }

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

  it('toggleInterviewer: Practice hidden does nothing', async () => {
    const { harness, pane } = startPracticePage();
    await settle();

    harness.started().commands.toggleInterviewer({ arg: undefined });

    expect(messagesOf(harness)).toContain(
      'toggleInterviewer ignored: practice hidden',
    );
    expect(messagesOf(harness)).not.toContain('shown');
    expect(pane.calls.filter((call) => call === 'toggle')).toEqual([]);
  });

  it('the outer panes take down only from the console', async () => {
    const { harness, pane } = startPracticePage();
    const commands = harness.started().commands;
    commands.showMode({ arg: undefined });
    await settle();

    const fromList = harness.outerPanes()!.focus.move('down');
    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    const fromProblem = harness.outerPanes()!.focus.move('down');
    const callsBeforeConsole = pane.calls.filter((call) =>
      call.startsWith('move'),
    );
    const consoleBody = asFake(harness.mode('practice.main').element)
      .querySelectorAll('.practice-tab-body')
      .at(-1);
    focusIn(consoleBody!);
    const fromConsole = harness.outerPanes()!.focus.move('down');

    expect([fromList, fromProblem, callsBeforeConsole]).toEqual([
      false,
      false,
      [],
    ]);
    expect([fromConsole, pane.calls.at(-1)]).toEqual([true, 'move down']);
  });

  it('the outer panes resize the interviewer divider, and the problem | code split only from the pane', async () => {
    const { harness, pane } = startPracticePage();
    const commands = harness.started().commands;
    commands.showMode({ arg: undefined });
    await settle();
    commands.listDown({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    for (const handle of asFake(
      harness.mode('practice.main').element,
    ).querySelectorAll('.ui-split-handle')) {
      handle.hasLayoutBox = true;
    }
    const resize = harness.outerPanes()!.resize;
    const fromColumn = [resize.nudge('left'), resize.nudge('up')];
    pane.spec!.tookKeys();
    const fromPane = [resize.nudge('left'), resize.nudge('up')];

    expect(fromColumn).toEqual([false, true]);
    expect(fromPane).toEqual([true, true]);
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

  it('layoutChange_FocusedNotesBox_KeepsItsEditor', async () => {
    const { harness, commands, boxEditors, boxFocuses } =
      await startWithProblemOpen();
    commands.showTab({ arg: 'notes' });
    commands.editBox({ arg: undefined });
    const [notes] = editorsOf(boxEditors, 'notes');
    const focusesBefore = boxFocuses.length;

    harness.showLayouts(
      withUser(defaultLayout, defaultLayout) as Parameters<
        typeof harness.showLayouts
      >[0],
    );

    expect(editorsOf(boxEditors, 'notes')).toEqual([notes]);
    expect(notes.isDestroyed).toBe(false);
    expect(boxFocuses.length).toBeGreaterThan(focusesBefore);
    expect(boxFocuses.at(-1)).toBe(notes);
  });

  // A layout change leaves the DOM focus where the keys were: an open dialog
  // and a focused box keep it, and a pane the redraw moved takes it back.
  it.each<{
    case: string;
    act: (
      commands: Awaited<ReturnType<typeof startWithProblemOpen>>['commands'],
    ) => void;
  }>([
    {
      case: 'ImportBoxInput',
      act: (commands) => commands.importStart({ arg: undefined }),
    },
    {
      case: 'NotesBox',
      act: (commands) => {
        commands.showTab({ arg: 'notes' });
        commands.editBox({ arg: undefined });
      },
    },
    { case: 'ProblemPaneBody', act: () => undefined },
    {
      case: 'FilterBox',
      act: (commands) => commands.filter({ arg: undefined }),
    },
  ])('layoutChange_FocusOn$case_KeepsIt', async ({ act }) => {
    const { harness, commands } = await startWithProblemOpen();
    act(commands);
    const focused = focusedElement();

    harness.showLayouts(
      withUser(defaultLayout, defaultLayout) as Parameters<
        typeof harness.showLayouts
      >[0],
    );

    expect(focused).not.toBeNull();
    expect(focusedElement()).toBe(focused);
  });

  it('layoutChange_UserNotesTabPlacingTheBoxTwice_DrawsWithDefault', async () => {
    const { harness, commands, boxEditors } = await startWithProblemOpen();
    commands.showTab({ arg: 'notes' });
    const userLayout = {
      ...defaultLayout,
      notesTab(
        parent: HTMLElement,
        kit: Parameters<typeof defaultLayout.notesTab>[1],
      ) {
        const root = kit.el(parent, 'div', 'user-notes');
        kit.textBox(root);
        kit.textBox(root);
        return root;
      },
    };

    harness.showLayouts(
      withUser(defaultLayout, userLayout) as Parameters<
        typeof harness.showLayouts
      >[0],
    );

    expect(messagesOf(harness)).toContainEqual(
      expect.stringMatching(/notesTab failed: .*textBox placed twice/),
    );
    const live = editorsOf(boxEditors, 'notes').filter(
      (made) => !made.isDestroyed,
    );
    expect(live).toHaveLength(1);
  });

  it('layoutChange_UserDialogFrame_BothDialogsCarryItsLayoutOnePanelEach', async () => {
    const { harness, commands } = await startWithProblemOpen();
    const panels = new Map<string, HTMLElement[]>();
    const userLayout = {
      ...defaultLayout,
      dialogFrame(
        parent: HTMLElement,
        input: Parameters<typeof defaultLayout.dialogFrame>[1],
        kit: Parameters<typeof defaultLayout.dialogFrame>[2],
      ) {
        const frame = defaultLayout.dialogFrame(parent, input, kit);
        panels.set(input.title, [
          ...(panels.get(input.title) ?? []),
          frame.element,
        ]);
        return frame;
      },
    };

    harness.showLayouts(
      withUser(defaultLayout, userLayout) as Parameters<
        typeof harness.showLayouts
      >[0],
    );
    commands.importStart({ arg: undefined });
    commands.showTab({ arg: 'solution' });

    expect([...panels.keys()].sort()).toEqual([
      'Import problems',
      'Open the solution?',
    ]);
    for (const [, drawn] of panels) {
      expect(drawn).toHaveLength(1);
      expect(drawn[0].dataset.layout).toBe(USER_LAYOUT);
    }
  });

  it('refreshedDraft_ShownNotesBox_MountsANewEditor', async () => {
    let notesOnDisk = '';
    const { harness, commands, boxEditors } = await startWithProblemOpen(
      (method, args) =>
        method === 'open' && args[0] === SECOND
          ? Promise.resolve({ ...opened(HARD), notes: notesOnDisk })
          : undefined,
    );
    commands.showTab({ arg: 'notes' });
    notesOnDisk = 'Two pointers';

    harness.send('changed', { slug: SECOND });
    await settle();
    await settle();

    const [earlier, live, ...rest] = editorsOf(boxEditors, 'notes');
    expect(rest).toEqual([]);
    expect(earlier.isDestroyed).toBe(true);
    expect(live).toMatchObject({ doc: 'Two pointers', isDestroyed: false });
  });

  it('keeps a notes draft saved while a changed read was pending', async () => {
    const save = deferred<undefined>();
    const read = deferred<OpenedProblem>();
    let opensOfSecond = 0;
    const { harness, calls, commands, editors, boxEditors } =
      await startWithProblemOpen((method, args) => {
        if (method === 'saveNotes') {
          return save.promise;
        }
        if (method === 'open' && args[0] === SECOND) {
          opensOfSecond += 1;
          return opensOfSecond === 2 ? read.promise : undefined;
        }
        return undefined;
      });
    commands.showTab({ arg: 'notes' });
    editors.type('typed');
    harness.advance(AUTOSAVE_DELAY_MS);
    await settle();
    const notesSaves = calls
      .filter((call) => call.method === 'saveNotes')
      .map((call) => call.args);

    harness.send('changed', { slug: SECOND });
    await settle();
    save.resolve(undefined);
    await settle();
    read.resolve({ ...opened(HARD), notes: '' });
    await settle();
    await settle();

    expect(notesSaves).toEqual([[SECOND, 'typed']]);
    const notesEditors = editorsOf(boxEditors, 'notes');
    expect(notesEditors).toHaveLength(1);
    expect(notesEditors[0].isDestroyed).toBe(false);
  });

  it('problemChange_ShownCustomCasesBox_MountsANewEditor', async () => {
    const { commands, boxEditors } = await startWithProblemOpen(
      (method, args) =>
        method === 'open' && args[0] === EASY.slug
          ? Promise.resolve({ ...opened(EASY), customCases: '[1, 2]' })
          : undefined,
    );

    commands.listUp({ arg: undefined });
    commands.openProblem({ arg: undefined });
    await settle();
    await settle();

    const [earlier, live, ...rest] = editorsOf(boxEditors, 'customCases');
    expect(rest).toEqual([]);
    expect(earlier.isDestroyed).toBe(true);
    expect(live).toMatchObject({ doc: '[1, 2]', isDestroyed: false });
  });

  it('stops with nothing live', async () => {
    const { harness } = await startWithProblemOpen();

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });
});
