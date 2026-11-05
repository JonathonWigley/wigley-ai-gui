import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  findAll,
  type FocusFakeDocument,
  FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { SessionRow, SessionTitles } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createRenameDialog } from './rename-dialog';
import { sessionsViewSetup } from './sessions-view-fakes';

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

function row(titles: SessionTitles = NO_TITLES): SessionRow {
  return {
    sessionId: 's1',
    label: 'gamma',
    project: 'project',
    harness: 'claude',
    marked: false,
    projectDir: null,
    hostSessionId: null,
    titles,
  };
}

// A promise and the calls that settle it.
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// A rename dialog at title length 40, drawn through the sessions view's
// parts, whose `setUserTitle` records each call and answers as `answer` says,
// and whose pushed scope records its pushes and pops and runs its base-change
// listener on `baseChanged`. `opener` is a connected element holding focus
// before the dialog opens; `view` is the sessions view whose parts draw it.
function dialogSetup(answer: () => Promise<void> = async () => undefined) {
  const invoked: [string, string | null][] = [];
  const logged: string[] = [];
  let pushes = 0;
  let pops = 0;
  let onBaseChanged: (base: string) => void = () => undefined;
  const { view } = sessionsViewSetup();
  const dialog = createRenameDialog({
    pushScope: () => {
      pushes += 1;
      return {
        pop: () => {
          throw new Error('the dialog closes by dispose');
        },
        dispose: () => {
          pops += 1;
        },
        onBaseChanged: (listener) => {
          onBaseChanged = listener;
          return { dispose: () => undefined };
        },
      };
    },
    setUserTitle: (sessionId, title) => {
      invoked.push([sessionId, title]);
      return answer();
    },
    titleMaxLength: () => 40,
    parts: view.parts,
    log: (message) => logged.push(message),
  });
  const root = asFake(dialog.element);
  const opener = new FocusFakeElement('div');
  opener.isPageRoot = true;
  opener.focus();
  return {
    dialog,
    view,
    invoked,
    logged,
    // The title box, drawn once the dialog opens.
    box: () => findAll(root, 'session-rename-box')[0] as FocusFakeElement,
    // Every body element of the given class.
    bodies: (className: string) => findAll(root, className),
    opener,
    // The problem line's text; null while none shows.
    problem: () =>
      findAll(root, 'session-rename-problem')[0]?.textContent ?? null,
    pushes: () => pushes,
    pops: () => pops,
    baseChanged: () => onBaseChanged('idle'),
  };
}

// Lets the invoke's `then` or `catch` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRenameDialog', () => {
  let doc: FocusFakeDocument;
  beforeEach(() => {
    doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
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

    box().value = typed;
    dialog.accept();
    await settle();

    expect(invoked).toEqual([['s1', title]]);
    expect(dialog.isOpen()).toBe(false);
    expect(pops()).toBe(1);
    expect(logged).toEqual([
      title === null
        ? 'cleared the user title of gamma'
        : `renamed gamma to "${title}"`,
    ]);
  });

  it('accept_PastTheLimit_StaysOpenShowingTheProblemUntilTheNextEdit', async () => {
    const { dialog, invoked, box, problem } = dialogSetup();
    dialog.open(row());

    box().value = 'a'.repeat(41);
    dialog.accept();
    await settle();

    expect(invoked).toEqual([]);
    expect(dialog.isOpen()).toBe(true);
    expect(problem()).toContain('41');
    expect(doc.activeElement).toBe(box());

    box().value = 'a'.repeat(40);
    box().fire('input');

    expect(problem()).toBeNull();
    expect(doc.activeElement).toBe(box());
  });

  it('accept_InvokeRejects_StaysOpenWithTheError', async () => {
    const { dialog, invoked, box, problem } = dialogSetup(async () => {
      throw new Error('main said no');
    });
    dialog.open(row());

    box().value = 'Fix it';
    dialog.accept();
    await settle();

    expect(invoked).toEqual([['s1', 'Fix it']]);
    expect(dialog.isOpen()).toBe(true);
    expect(problem()).toContain('main said no');
  });

  it('accept_WhileAnInvokeIsInFlight_InvokesNothingMore', async () => {
    const pending = deferred();
    const { dialog, invoked, box } = dialogSetup(() => pending.promise);
    dialog.open(row());

    box().value = 'Fix it';
    dialog.accept();
    box().value = 'Fix it again';
    dialog.accept();
    pending.resolve();
    await settle();

    expect(invoked).toEqual([['s1', 'Fix it']]);
  });

  it.each([
    {
      case: 'main sets it',
      settleWith: (pending: ReturnType<typeof deferred>) => pending.resolve(),
      line: 'renamed gamma to "Fix it"',
    },
    {
      case: 'main refuses it',
      settleWith: (pending: ReturnType<typeof deferred>) =>
        pending.reject(new Error('main said no')),
      line: 'rename failed: main said no',
    },
  ])(
    'cancel_WhileAnInvokeIsInFlight_ClosesAndLogsTheOutcome ($case)',
    async ({ settleWith, line }) => {
      const pending = deferred();
      const { dialog, logged, box, problem } = dialogSetup(
        () => pending.promise,
      );
      dialog.open(row());

      box().value = 'Fix it';
      dialog.accept();
      dialog.cancel();
      settleWith(pending);
      await settle();

      expect(dialog.isOpen()).toBe(false);
      expect(problem()).toBeNull();
      expect(logged).toEqual([line]);
    },
  );

  it('cancel_AfterTyping_InvokesNothing', async () => {
    const { dialog, invoked, box, pops } = dialogSetup();
    dialog.open(row());

    box().value = 'Fix it';
    dialog.cancel();
    await settle();

    expect(invoked).toEqual([]);
    expect(dialog.isOpen()).toBe(false);
    expect(pops()).toBe(1);
  });

  it.each([
    {
      case: 'accept',
      close: async (setup: ReturnType<typeof dialogSetup>) => {
        setup.box().value = 'Fix it';
        setup.dialog.accept();
        await settle();
      },
    },
    {
      case: 'cancel',
      close: async (setup: ReturnType<typeof dialogSetup>) =>
        setup.dialog.cancel(),
    },
    {
      case: 'base scope changed',
      close: async (setup: ReturnType<typeof dialogSetup>) =>
        setup.baseChanged(),
    },
  ])(
    'close_EachWay_PopsItsScopeAndGivesFocusBack ($case)',
    async ({ close }) => {
      const setup = dialogSetup();
      setup.dialog.open(row());
      expect(doc.activeElement).toBe(setup.box());

      await close(setup);

      expect(setup.dialog.isOpen()).toBe(false);
      expect(setup.pops()).toBe(1);
      expect(doc.activeElement).toBe(setup.opener);
    },
  );

  it('close_FocusMovedElsewhereMeanwhile_KeepsIt', () => {
    const { dialog } = dialogSetup();
    dialog.open(row());
    const elsewhere = new FocusFakeElement('div');
    elsewhere.isPageRoot = true;
    elsewhere.focus();

    dialog.cancel();

    expect(doc.activeElement).toBe(elsewhere);
  });

  it('open_WhileOpen_KeepsTheFirstSession', () => {
    const { dialog, box, pushes } = dialogSetup();
    dialog.open(row({ ...NO_TITLES, user: 'First' }));

    dialog.open(row({ ...NO_TITLES, user: 'Second' }));

    expect(box().value).toBe('First');
    expect(pushes()).toBe(1);
  });

  it.each<{ case: string; layout: Layout; boxAt: number }>([
    {
      case: 'layout leaves the box out',
      layout: {
        renameDialog: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'mine-rename');
          kit.el(element, 'p', 'mine-hint', input.hint);
          return { element };
        },
      },
      boxAt: 0,
    },
    {
      case: 'layout places the box after the hint',
      layout: {
        renameDialog: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'mine-rename');
          kit.el(element, 'p', 'mine-hint', input.hint);
          kit.textBox(element);
          return { element };
        },
      },
      boxAt: 1,
    },
  ])(
    'redraw_LayoutsChanged_DrawsTheBodyAgainKeepingTheBox ($case)',
    ({ layout, boxAt }) => {
      const { dialog, view, box, bodies } = dialogSetup();
      dialog.open(row());
      box().value = 'Half typed';

      view.setLayouts(withUser<Layout>(defaultLayout, layout));
      dialog.redraw();

      expect(bodies('session-rename')).toEqual([]);
      const [body] = bodies('mine-rename');
      expect(body?.dataset.layout).toBe('mine');
      expect(box().parentNode).toBe(body?.children[boxAt]);
      expect(box().value).toBe('Half typed');
      expect(doc.activeElement).toBe(box());
    },
  );

  it('open_FirstMessageOnly_PrefillsTheUncutText', () => {
    const { dialog, box } = dialogSetup();
    const message =
      'Look into why the docs index skips symlinked folders on Windows';

    dialog.open(row({ ...NO_TITLES, firstMessage: message }));

    expect(box().value).toBe(message);
  });
});
