import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  findAll,
  type FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { SessionRow, SessionTitles } from '../contract';
import { createRenameDialog } from './rename-dialog';

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

function row(titles: SessionTitles = NO_TITLES): SessionRow {
  return {
    sessionId: 's1',
    label: 'gamma',
    harness: 'claude',
    marked: false,
    projectDir: null,
    hostSessionId: null,
    titles,
  };
}

// A rename dialog at title length 40 whose `setUserTitle` records each call
// and answers as `answer` says, and whose pushed scope records its pops.
function dialogSetup(answer: () => Promise<void> = async () => undefined) {
  const invoked: [string, string | null][] = [];
  const logged: string[] = [];
  let pops = 0;
  const dialog = createRenameDialog({
    pushScope: () => ({
      pop: () => {
        pops += 1;
      },
      onBaseChanged: () => undefined,
    }),
    setUserTitle: (sessionId, title) => {
      invoked.push([sessionId, title]);
      return answer();
    },
    titleMaxLength: () => 40,
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  const root = asFake(dialog.element);
  const box = findAll(root, 'session-rename-box')[0] as FocusFakeElement;
  const problem = findAll(root, 'session-rename-problem')[0];
  return { dialog, invoked, logged, box, problem, pops: () => pops };
}

// Lets the invoke's `then` or `catch` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRenameDialog', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'a title', typed: 'Fix it', title: 'Fix it' },
    { case: 'spaces collapsed', typed: '  Fix   it ', title: 'Fix it' },
    { case: 'empty', typed: '', title: null },
    { case: 'spaces only', typed: '   ', title: null },
  ])('accept_TypedBox_InvokesAndCloses ($case)', async ({ typed, title }) => {
    const { dialog, invoked, logged, box, pops } = dialogSetup();
    dialog.open(row({ ...NO_TITLES, agent: 'Agent title' }));

    box.value = typed;
    dialog.accept();
    await settle();

    expect(invoked).toEqual([['s1', title]]);
    expect(dialog.isOpen()).toBe(false);
    expect(pops()).toBe(1);
    expect(logged).toEqual([
      title === null
        ? '[sessions] cleared the user title of gamma'
        : `[sessions] renamed gamma to "${title}"`,
    ]);
  });

  it('accept_PastTheLimit_StaysOpenShowingTheProblem', async () => {
    const { dialog, invoked, box, problem } = dialogSetup();
    dialog.open(row());

    box.value = 'a'.repeat(41);
    dialog.accept();
    await settle();

    expect(invoked).toEqual([]);
    expect(dialog.isOpen()).toBe(true);
    expect(problem.hidden).toBe(false);
    expect(problem.textContent).toContain('41');
  });

  it('accept_InvokeRejects_StaysOpenWithTheError', async () => {
    const { dialog, invoked, box, problem } = dialogSetup(async () => {
      throw new Error('main said no');
    });
    dialog.open(row());

    box.value = 'Fix it';
    dialog.accept();
    await settle();

    expect(invoked).toEqual([['s1', 'Fix it']]);
    expect(dialog.isOpen()).toBe(true);
    expect(problem.textContent).toContain('main said no');
  });

  it('cancel_AfterTyping_InvokesNothing', async () => {
    const { dialog, invoked, box, pops } = dialogSetup();
    dialog.open(row());

    box.value = 'Fix it';
    dialog.cancel();
    await settle();

    expect(invoked).toEqual([]);
    expect(dialog.isOpen()).toBe(false);
    expect(pops()).toBe(1);
  });

  it('open_FirstMessageOnly_PrefillsTheUncutText', () => {
    const { dialog, box } = dialogSetup();
    const message =
      'Look into why the docs index skips symlinked folders on Windows';

    dialog.open(row({ ...NO_TITLES, firstMessage: message }));

    expect(box.value).toBe(message);
  });
});
