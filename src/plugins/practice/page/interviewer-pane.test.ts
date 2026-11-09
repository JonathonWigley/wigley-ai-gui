import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { PaneDirection } from '../../../contracts/panes';
import type { PageChannel } from '../../../contracts/plugin';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { PracticeChannel } from '../contract';
import { createInterviewerPane } from './interviewer-pane';
import type { PracticeFocus } from './practice-state';

// One box the fake host made: its text, each focus call's options, and
// whether it was destroyed.
interface FakeBox {
  text: string;
  focusOptions: unknown[];
  isDestroyed: boolean;
}

// One `mountChat` call and the calls on its handle.
interface FakeMount {
  element: HTMLElement;
  sessionId: string;
  shown: number;
  hidden: number;
  disposed: number;
}

function fakeEditorHost() {
  const boxes: FakeBox[] = [];
  const host = {
    create(_parent: HTMLElement, doc: string, events: EditorEvents) {
      const box: FakeBox = { text: doc, focusOptions: [], isDestroyed: false };
      boxes.push(box);
      return {
        text: () => box.text,
        setText: (text: string) => {
          box.text = text;
        },
        insert: () => undefined,
        charBeforeCursor: () => '',
        focus: (options: unknown) => {
          box.focusOptions.push(options);
          events.focused();
        },
        blur: () => events.blurred(),
        destroy: () => {
          box.isDestroyed = true;
        },
      };
    },
  } as unknown as EditorHost;
  return { host, boxes };
}

// An interviewer pane over a channel whose `interviewerOf` and
// `askInterviewer` answers wait in `interviewerAnswers` and `askAnswers`,
// one per call, in call order. The fake view keeps the focus and tells the
// pane when it leaves `interviewer`, as the real view's `setFocus` does;
// `viewCalls` records its calls. `events` records each `interviewerOf` and
// each mount's `dispose`, in order.
function paneSetup() {
  const logs: string[] = [];
  const toasts: [string, string][] = [];
  const scopes: string[] = [];
  const events: string[] = [];
  const asks: [string, string][] = [];
  const interviewerAnswers: ReturnType<typeof deferred<string | null>>[] = [];
  const askAnswers: ReturnType<typeof deferred<string>>[] = [];
  const mounts: FakeMount[] = [];
  const viewCalls: string[] = [];
  let focus: PracticeFocus = 'main';
  const { host, boxes } = fakeEditorHost();
  const channel = {
    invoke(method: string, ...args: string[]) {
      if (method === 'interviewerOf') {
        events.push(`interviewerOf ${args[0]!}`);
        const answer = deferred<string | null>();
        interviewerAnswers.push(answer);
        return answer.promise;
      }
      asks.push([args[0]!, args[1]!]);
      const answer = deferred<string>();
      askAnswers.push(answer);
      return answer.promise;
    },
  } as unknown as PageChannel<PracticeChannel>;
  const view = {
    setFocus(next: PracticeFocus) {
      viewCalls.push(`setFocus ${next}`);
      const before = focus;
      focus = next;
      if (before === 'interviewer' && next !== 'interviewer') {
        pane.columnTookKeys();
      }
    },
    focusColumn() {
      viewCalls.push('focusColumn');
      view.setFocus('main');
    },
  };
  const pane = createInterviewerPane({
    channel,
    editor: host,
    keys: recordingAnchors().keys,
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    setScope: (scope) => scopes.push(scope),
    setResizeTarget: () => undefined,
    setFocusTarget: () => undefined,
    mountChat(element, sessionId) {
      const mount: FakeMount = {
        element,
        sessionId,
        shown: 0,
        hidden: 0,
        disposed: 0,
      };
      mounts.push(mount);
      return {
        shown: () => {
          mount.shown += 1;
        },
        hidden: () => {
          mount.hidden += 1;
        },
        dispose: () => {
          mount.disposed += 1;
          events.push(`dispose ${sessionId}`);
        },
      };
    },
    workspace: {
      setSidePaneShown: () => undefined,
      sideResizeTarget: { nudge: () => true },
    },
    view,
    focus: () => focus,
    problemTitle: () => 'Two Sum',
    drawAskBox: (parent, _input, frame) => {
      parent.append(frame);
      return {
        built: { element: frame },
        layoutName: 'default',
        drewPick: false,
        dispose: () => undefined,
      };
    },
  });
  return {
    pane,
    logs,
    toasts,
    scopes,
    events,
    asks,
    mounts,
    boxes,
    viewCalls,
    focus: () => focus,
    // Answers the oldest unanswered `interviewerOf` and lets it land.
    async answerInterviewer(sessionId: string | null) {
      interviewerAnswers.shift()!.resolve(sessionId);
      await settle();
    },
    async answerAsk(answer: { sessionId: string } | { error: string }) {
      const pending = askAnswers.shift()!;
      if ('sessionId' in answer) {
        pending.resolve(answer.sessionId);
      } else {
        pending.reject(new Error(answer.error));
      }
      await settle();
    },
    // Opens Two Sum's attempt `a1` and the pane, answered with `sessionId`.
    async openTwoSum(sessionId: string | null) {
      pane.problemOpened('two-sum', 'a1');
      pane.toggle();
      await this.answerInterviewer(sessionId);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createInterviewerPane', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the ask box when the attempt has no interviewer', async () => {
    const setup = paneSetup();

    await setup.openTwoSum(null);

    expect(setup.scopes).toEqual(['ask']);
    expect(setup.boxes.map((box) => box.focusOptions)).toEqual([
      [{ insertAtEnd: true }],
    ]);
    expect(setup.focus()).toBe('interviewer');
    expect(setup.logs).toEqual([
      'interviewer pane shown',
      'ask box shown for two-sum',
      'interviewer focused',
    ]);
  });

  it("mounts the interviewer's chat when the attempt has one", async () => {
    const setup = paneSetup();

    await setup.openTwoSum('s1');

    expect(
      setup.mounts.map((mount) => [mount.element, mount.sessionId]),
    ).toEqual([[setup.pane.element, 's1']]);
    expect(setup.mounts[0]!.shown).toBe(1);
    expect(setup.boxes).toHaveLength(0);
    expect(setup.logs).toContain('interviewer mounted two-sum');
  });

  it.each<{
    case: string;
    typed: string;
    sends: number;
    answer: { sessionId: string } | { error: string } | null;
    asks: [string, string][];
    mounted: string[];
    isBoxKept: boolean;
    line: string;
    toasts: [string, string][];
  }>([
    {
      case: 'a question',
      typed: 'how do I start',
      sends: 1,
      answer: { sessionId: 's2' },
      asks: [['two-sum', 'how do I start']],
      mounted: ['s2'],
      isBoxKept: false,
      line: 'interviewer mounted two-sum',
      toasts: [],
    },
    {
      case: 'blank',
      typed: '   ',
      sends: 1,
      answer: null,
      asks: [],
      mounted: [],
      isBoxKept: true,
      line: 'ask ignored: empty',
      toasts: [],
    },
    {
      case: 'a second send while pending',
      typed: 'hint please',
      sends: 2,
      answer: null,
      asks: [['two-sum', 'hint please']],
      mounted: [],
      isBoxKept: true,
      line: 'ask ignored: sending',
      toasts: [],
    },
    {
      case: 'rejected',
      typed: 'hint please',
      sends: 1,
      answer: { error: 'no harness' },
      asks: [['two-sum', 'hint please']],
      mounted: [],
      isBoxKept: true,
      line: 'ask failed: no harness',
      toasts: [['Could not start the interviewer: no harness', 'error']],
    },
  ])('send: $case', async (row) => {
    const setup = paneSetup();
    await setup.openTwoSum(null);
    setup.boxes[0]!.text = row.typed;

    for (let sent = 0; sent < row.sends; sent += 1) {
      setup.pane.send();
    }
    if (row.answer !== null) {
      await setup.answerAsk(row.answer);
    }

    expect(setup.asks).toEqual(row.asks);
    expect(setup.mounts.map((mount) => mount.sessionId)).toEqual(row.mounted);
    expect(setup.boxes[0]).toMatchObject({
      isDestroyed: !row.isBoxKept,
      text: row.typed,
    });
    expect(setup.logs).toContain(row.line);
    expect(setup.toasts).toEqual(row.toasts);
  });

  it('keeps the keys on the mount that replaces the ask box', async () => {
    const setup = paneSetup();
    await setup.openTwoSum(null);
    setup.boxes[0]!.text = 'how do I start';

    setup.pane.send();
    await setup.answerAsk({ sessionId: 's2' });

    expect(setup.mounts[0]!.shown).toBe(1);
  });

  it('drops an interviewer answer for a problem no longer open', async () => {
    const setup = paneSetup();
    setup.pane.problemOpened('two-sum', 'a1');
    setup.pane.toggle();

    setup.pane.problemOpened('lru-cache', 'a2');
    await setup.answerInterviewer('s1');

    expect(setup.mounts).toHaveLength(0);
  });

  it.each<{
    case: string;
    answer: string | null;
    next: [string, string];
    events: string[];
    liveBoxTexts: string[];
  }>([
    {
      case: 'the same pair keeps the mount',
      answer: 's1',
      next: ['two-sum', 'a1'],
      events: ['interviewerOf two-sum'],
      liveBoxTexts: [],
    },
    {
      case: 'the same pair keeps the typed text',
      answer: null,
      next: ['two-sum', 'a1'],
      events: ['interviewerOf two-sum'],
      liveBoxTexts: ['draft'],
    },
    {
      case: 'a fresh attempt',
      answer: 's1',
      next: ['two-sum', 'a2'],
      events: ['interviewerOf two-sum', 'dispose s1', 'interviewerOf two-sum'],
      liveBoxTexts: [],
    },
    {
      case: 'another problem',
      answer: 's1',
      next: ['lru-cache', 'a3'],
      events: [
        'interviewerOf two-sum',
        'dispose s1',
        'interviewerOf lru-cache',
      ],
      liveBoxTexts: [],
    },
  ])('remounts only when the pair changes: $case', async (row) => {
    const setup = paneSetup();
    await setup.openTwoSum(row.answer);
    for (const box of setup.boxes) {
      box.text = 'draft';
    }

    setup.pane.problemOpened(...row.next);

    expect(setup.events).toEqual(row.events);
    expect(
      setup.boxes.filter((box) => !box.isDestroyed).map((box) => box.text),
    ).toEqual(row.liveBoxTexts);
  });

  it.each<{
    case: string;
    state: 'holding' | 'column' | 'hidden';
    direction: PaneDirection;
    result: boolean;
    viewCalls: string[];
    logs: string[];
  }>([
    {
      case: 'left from the pane',
      state: 'holding',
      direction: 'left',
      result: true,
      viewCalls: ['focusColumn', 'setFocus main'],
      logs: ['interviewer left'],
    },
    {
      case: 'right from the column',
      state: 'column',
      direction: 'right',
      result: true,
      viewCalls: ['setFocus interviewer'],
      logs: ['interviewer focused'],
    },
    {
      case: 'right with the pane hidden',
      state: 'hidden',
      direction: 'right',
      result: false,
      viewCalls: [],
      logs: [],
    },
    ...(['holding', 'column'] as const).flatMap((state) =>
      (['up', 'down'] as const).map((direction) => ({
        case: `${direction} from ${state}`,
        state,
        direction,
        result: false,
        viewCalls: [],
        logs: [],
      })),
    ),
  ])('outer panes: $case', async (row) => {
    const setup = paneSetup();
    if (row.state === 'hidden') {
      setup.pane.problemOpened('two-sum', 'a1');
    } else {
      await setup.openTwoSum('s1');
    }
    if (row.state === 'column') {
      setup.pane.leaveBox();
    }
    setup.viewCalls.length = 0;
    setup.logs.length = 0;

    const result = setup.pane.outerPanes.focus.move(row.direction);

    expect(result).toBe(row.result);
    expect(setup.viewCalls).toEqual(row.viewCalls);
    expect(setup.logs).toEqual(row.logs);
  });

  it('gives up the keys when the column takes them', async () => {
    const setup = paneSetup();
    await setup.openTwoSum('s1');

    setup.pane.columnTookKeys();
    setup.pane.columnTookKeys();

    expect(setup.mounts[0]!.hidden).toBe(1);
    expect(
      setup.logs.filter((line) => line === 'interviewer left'),
    ).toHaveLength(1);
  });

  it('modeHidden hides the mount and keeps it', async () => {
    const setup = paneSetup();
    await setup.openTwoSum('s1');

    setup.pane.modeHidden();

    expect(setup.mounts[0]).toMatchObject({ hidden: 1, disposed: 0 });
    expect(setup.focus()).toBe('main');
  });

  it('toasts and opens nothing with no open problem', () => {
    const setup = paneSetup();

    setup.pane.toggle();

    expect(setup.pane.isShown()).toBe(false);
    expect(setup.events).toEqual([]);
    expect(setup.toasts).toEqual([['Open a problem first', 'info']]);
    expect(setup.logs).toEqual(['interviewer needs an open problem']);
  });
});
