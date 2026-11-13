import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { PaneDirection } from '../../../contracts/panes';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { asFake, installFocusFakeDom } from '../../../shared/page/test-dom';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { AgentPaneSpec } from '../contract';
import type { AskBoxInput } from '../layouts/layout';
import { createAgentPane } from './agent-pane';

// One box the fake host made: the element it mounted in, its text, each
// focus call's options, and whether it was destroyed.
interface FakeBox {
  parent: HTMLElement;
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
    create(parent: HTMLElement, doc: string, events: EditorEvents) {
      const box: FakeBox = {
        parent,
        text: doc,
        focusOptions: [],
        isDestroyed: false,
      };
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

// Practice's interviewer pane over deps whose `sessionOf` and `ask` answers
// wait in `sessionAnswers` and `askAnswers`, one per call, in call order. The
// spec's `tookKeys` gives the fake host's focus to the pane and its `leave`
// takes it back and tells the pane, as a host does, unless `hostAnswersLeave`
// is false; `calls` records them and `setShown`. The pane starts hidden and is
// entered from the right unless `isAlwaysShown` and `entersFrom` say
// otherwise. `events` records each
// `sessionOf`, each `setScope`, `setFocusTarget` and `setResizeTarget`, and
// each mount's `dispose`, in order. `mountError` makes every `mountChat` throw
// it.
function paneSetup(
  options: {
    mountError?: string;
    hostAnswersLeave?: boolean;
    isAlwaysShown?: boolean;
    entersFrom?: PaneDirection;
  } = {},
) {
  const logs: string[] = [];
  const toasts: [string, string][] = [];
  const events: string[] = [];
  const calls: string[] = [];
  const asks: [string, string][] = [];
  const drawnInputs: AskBoxInput[] = [];
  const sessionAnswers: ReturnType<typeof deferred<string | null>>[] = [];
  const askAnswers: ReturnType<typeof deferred<string>>[] = [];
  const mounts: FakeMount[] = [];
  let focus: 'host' | 'pane' = 'host';
  let heading = 'Two Sum';
  const { host, boxes } = fakeEditorHost();
  const spec: AgentPaneSpec = {
    owner: 'practice',
    agentId: 'interviewer',
    heading: () => heading,
    hint: 'Ask about the problem.',
    setShown: (shown) => calls.push(`setShown ${shown}`),
    isAlwaysShown: options.isAlwaysShown ?? false,
    entersFrom: options.entersFrom ?? 'right',
    resizeTarget: { nudge: () => true },
    tookKeys() {
      calls.push('tookKeys');
      focus = 'pane';
    },
    leave() {
      calls.push('leave');
      focus = 'host';
      if (options.hostAnswersLeave !== false) {
        pane.hostTookKeys();
      }
    },
  };
  const pane = createAgentPane(
    {
      ask(scope, text) {
        asks.push([scope, text]);
        const answer = deferred<string>();
        askAnswers.push(answer);
        return answer.promise;
      },
      sessionOf(scope) {
        events.push(`sessionOf ${scope}`);
        const answer = deferred<string | null>();
        sessionAnswers.push(answer);
        return answer.promise;
      },
      editor: host,
      keys: recordingAnchors().keys,
      log: (line) => logs.push(line),
      toast: (text, tone) => toasts.push([text, tone]),
      setScope: (scope) => events.push(`setScope ${scope}`),
      setResizeTarget: () => events.push('setResizeTarget'),
      setFocusTarget: (target) =>
        events.push(`setFocusTarget ${target === null ? 'null' : 'target'}`),
      mountChat(element, sessionId) {
        if (options.mountError !== undefined) {
          throw new Error(options.mountError);
        }
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
      drawAskBox: (parent, input, frame) => {
        drawnInputs.push(input);
        parent.append(frame);
        return {
          built: { element: frame },
          layoutName: 'default',
          drewPick: false,
          dispose: () => undefined,
        };
      },
      heldKeys: () => undefined,
    },
    spec,
  );
  return {
    pane,
    logs,
    toasts,
    events,
    calls,
    asks,
    drawnInputs,
    mounts,
    boxes,
    focus: () => focus,
    setHeading(next: string) {
      heading = next;
    },
    // Answers the oldest unanswered `sessionOf` and lets it land.
    async answerSession(sessionId: string | null) {
      sessionAnswers.shift()!.resolve(sessionId);
      await settle();
    },
    // Fails the oldest unanswered `sessionOf` with `error`.
    async failSession(error: string) {
      sessionAnswers.shift()!.reject(new Error(error));
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
    // Opens the scope `two-sum` and the pane, answered with `sessionId`.
    async openTwoSum(sessionId: string | null) {
      pane.scopeOpened('two-sum');
      pane.toggle();
      await this.answerSession(sessionId);
    },
  };
}

type Setup = ReturnType<typeof paneSetup>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const liveBoxCount = (setup: Setup) =>
  setup.boxes.filter((box) => !box.isDestroyed).length;

describe('createAgentPane', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the ask box when the scope has no session', async () => {
    const setup = paneSetup();

    await setup.openTwoSum(null);

    expect(setup.events).toEqual([
      'sessionOf two-sum',
      'setScope ask',
      'setFocusTarget null',
      'setResizeTarget',
    ]);
    expect(setup.calls).toEqual(['setShown true', 'tookKeys']);
    expect(setup.boxes.map((box) => box.focusOptions)).toEqual([
      [{ insertAtEnd: true }],
    ]);
    expect(setup.focus()).toBe('pane');
    expect(setup.logs).toEqual([
      'interviewer pane shown',
      'interviewer ask box shown for two-sum',
      'interviewer focused',
    ]);
  });

  it("mounts the session's chat when the scope has one", async () => {
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
      line: 'interviewer ask ignored: empty',
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
      line: 'interviewer ask ignored: sending',
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
      line: 'interviewer ask failed: no harness',
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

  it('keeps the focus in the ask box across a redraw', async () => {
    const setup = paneSetup();
    await setup.openTwoSum(null);
    const content = document.createElement('div');
    setup.boxes[0]!.parent.append(content);
    content.focus();
    setup.setHeading('LRU Cache');

    setup.pane.redraw();

    expect(document.activeElement === content).toBe(true);
    expect(setup.drawnInputs.at(-1)!.heading).toBe('LRU Cache');
  });

  it('keeps the keys on the mount that replaces the ask box', async () => {
    const setup = paneSetup();
    await setup.openTwoSum(null);
    setup.boxes[0]!.text = 'how do I start';

    setup.pane.send();
    await setup.answerAsk({ sessionId: 's2' });

    expect(setup.mounts[0]!.shown).toBe(1);
  });

  it.each<{
    case: string;
    leave: (pane: Setup['pane']) => void;
    // The scope read again once the first answer lands; null for none.
    reread: string | null;
  }>([
    {
      case: 'another scope opened',
      leave: (pane) => pane.scopeOpened('lru-cache'),
      reread: 'lru-cache',
    },
    {
      case: 'the pane disposed',
      leave: (pane) => pane.dispose(),
      reread: null,
    },
    {
      case: 'the scope closed and reopened as the same scope',
      leave: (pane) => {
        pane.scopeOpened(null);
        pane.scopeOpened('two-sum');
      },
      reread: 'two-sum',
    },
  ])('drops a sessionOf answer once $case', async (row) => {
    const setup = paneSetup();
    setup.pane.scopeOpened('two-sum');
    setup.pane.toggle();

    row.leave(setup.pane);
    await setup.answerSession('s1');
    const mountedFirst = setup.mounts.length;
    const callsFirst = [...setup.calls];
    if (row.reread !== null) {
      await setup.answerSession('s2');
    }

    expect(mountedFirst).toBe(0);
    expect(callsFirst).toEqual(['setShown true']);
    expect(setup.mounts.map((mount) => mount.sessionId)).toEqual(
      row.reread === null ? [] : ['s2'],
    );
    expect(setup.logs.filter((line) => line.includes('mounted'))).toEqual(
      row.reread === null ? [] : [`interviewer mounted ${row.reread}`],
    );
  });

  it('takes no keys on a later answer once the read failed', async () => {
    const setup = paneSetup();
    setup.pane.scopeOpened('two-sum');
    setup.pane.toggle();
    await setup.failSession('no harness');

    setup.pane.scopeOpened(null);
    setup.pane.scopeOpened('two-sum');
    await setup.answerSession(null);

    expect(setup.focus()).toBe('host');
    expect(setup.calls).not.toContain('tookKeys');
    expect(setup.events).not.toContain('setScope ask');
    expect(setup.toasts).toEqual([['no harness', 'error']]);
    expect(setup.logs).toContain('interviewer not read two-sum: no harness');
  });

  it('keeps the keys in the pane when the chat view fails to mount', async () => {
    const setup = paneSetup({ mountError: 'no view' });

    await setup.openTwoSum('s1');

    expect(setup.focus()).toBe('pane');
    expect(setup.events).toContain('setScope ask');
    expect(setup.toasts).toEqual([['no view', 'error']]);
    expect(setup.logs).toContain('interviewer not mounted two-sum: no view');
  });

  it.each<{
    case: string;
    answer: string | null;
    next: (string | null)[];
    events: string[];
    liveBoxTexts: string[];
  }>([
    {
      case: 'the same scope keeps the mount',
      answer: 's1',
      next: ['two-sum'],
      events: ['sessionOf two-sum'],
      liveBoxTexts: [],
    },
    {
      case: 'the same scope keeps the typed text',
      answer: null,
      next: ['two-sum'],
      events: [
        'sessionOf two-sum',
        'setScope ask',
        'setFocusTarget null',
        'setResizeTarget',
      ],
      liveBoxTexts: ['draft'],
    },
    {
      case: 'the scope closed and opened again',
      answer: 's1',
      next: [null, 'two-sum'],
      events: ['sessionOf two-sum', 'dispose s1', 'sessionOf two-sum'],
      liveBoxTexts: [],
    },
    {
      case: 'another scope',
      answer: 's1',
      next: ['lru-cache'],
      events: ['sessionOf two-sum', 'dispose s1', 'sessionOf lru-cache'],
      liveBoxTexts: [],
    },
  ])('remounts only when the scope changes: $case', async (row) => {
    const setup = paneSetup();
    await setup.openTwoSum(row.answer);
    for (const box of setup.boxes) {
      box.text = 'draft';
    }

    for (const scope of row.next) {
      setup.pane.scopeOpened(scope);
    }

    expect(setup.events).toEqual(row.events);
    expect(
      setup.boxes.filter((box) => !box.isDestroyed).map((box) => box.text),
    ).toEqual(row.liveBoxTexts);
  });

  it.each<{
    case: string;
    state: 'holding' | 'host' | 'hidden';
    hostAnswersLeave?: false;
    direction: PaneDirection;
    result: boolean;
    calls: string[];
    logs: string[];
  }>([
    {
      case: 'left from the pane',
      state: 'holding',
      direction: 'left',
      result: true,
      calls: ['leave'],
      logs: ['interviewer left'],
    },
    {
      case: "left from the pane, the host's leave not answering",
      state: 'holding',
      hostAnswersLeave: false,
      direction: 'left',
      result: true,
      calls: ['leave'],
      logs: ['interviewer left'],
    },
    {
      case: 'right from the host',
      state: 'host',
      direction: 'right',
      result: true,
      calls: ['tookKeys'],
      logs: ['interviewer focused'],
    },
    {
      case: 'right with the pane hidden',
      state: 'hidden',
      direction: 'right',
      result: false,
      calls: [],
      logs: [],
    },
    ...(['holding', 'host'] as const).flatMap((state) =>
      (['up', 'down'] as const).map((direction) => ({
        case: `${direction} from ${state}`,
        state,
        direction,
        result: false,
        calls: [],
        logs: [],
      })),
    ),
  ])('outer panes: $case', async (row) => {
    const setup = paneSetup({ hostAnswersLeave: row.hostAnswersLeave });
    if (row.state === 'hidden') {
      setup.pane.scopeOpened('two-sum');
    } else {
      await setup.openTwoSum('s1');
    }
    if (row.state === 'host') {
      setup.pane.leaveBox();
    }
    setup.calls.length = 0;
    setup.logs.length = 0;

    const result = setup.pane.outerPanes.focus.move(row.direction);

    expect(result).toBe(row.result);
    expect(setup.calls).toEqual(row.calls);
    expect(setup.logs).toEqual(row.logs);
  });

  it('gives up the keys when the host takes them', async () => {
    const setup = paneSetup();
    await setup.openTwoSum('s1');

    setup.pane.hostTookKeys();
    setup.pane.hostTookKeys();

    expect(setup.mounts[0]!.hidden).toBe(1);
    expect(
      setup.logs.filter((line) => line === 'interviewer left'),
    ).toHaveLength(1);
  });

  it.each<{
    case: string;
    act: (setup: Setup) => Promise<void>;
    calls: string[];
    mount: { hidden: number; disposed: number } | null;
    liveBoxes: number;
  }>([
    {
      case: 'while the pane holds the keys',
      act: async (setup) => {
        await setup.openTwoSum('s1');
        setup.pane.modeHidden();
      },
      calls: ['setShown true', 'tookKeys', 'leave'],
      mount: { hidden: 1, disposed: 0 },
      liveBoxes: 0,
    },
    {
      case: 'while the pane does not hold the keys',
      act: async (setup) => {
        await setup.openTwoSum('s1');
        setup.pane.leaveBox();
        setup.pane.modeHidden();
      },
      calls: ['setShown true', 'tookKeys', 'leave'],
      mount: { hidden: 1, disposed: 0 },
      liveBoxes: 0,
    },
    {
      case: 'before the answer lands',
      act: async (setup) => {
        setup.pane.scopeOpened('two-sum');
        setup.pane.toggle();
        setup.pane.modeHidden();
        await setup.answerSession(null);
      },
      calls: ['setShown true'],
      mount: null,
      liveBoxes: 1,
    },
  ])('modeHidden: $case', async (row) => {
    const setup = paneSetup();

    await row.act(setup);

    expect(setup.calls).toEqual(row.calls);
    expect(setup.mounts[0] ?? null).toEqual(
      row.mount === null ? null : expect.objectContaining(row.mount),
    );
    expect(liveBoxCount(setup)).toBe(row.liveBoxes);
    expect(setup.pane.isShown()).toBe(true);
  });

  it('always shown: shows from the start and fills each scope without taking the keys', async () => {
    const setup = paneSetup({ isAlwaysShown: true });

    setup.pane.scopeOpened('two-sum');
    await setup.answerSession(null);

    expect(setup.pane.isShown()).toBe(true);
    expect(setup.calls).toEqual(['setShown true']);
    expect(setup.events).toEqual(['sessionOf two-sum']);
    expect(setup.focus()).toBe('host');
    expect(setup.logs).toEqual([
      'interviewer pane shown',
      'interviewer ask box shown for two-sum',
    ]);
  });

  it.each<{
    case: string;
    toggles: number;
    calls: string[];
    focus: 'host' | 'pane';
  }>([
    {
      case: 'once gives the pane the keys',
      toggles: 1,
      calls: ['tookKeys'],
      focus: 'pane',
    },
    {
      case: 'twice hands them back and keeps the pane shown',
      toggles: 2,
      calls: ['tookKeys', 'leave'],
      focus: 'host',
    },
  ])('always shown: toggle $case', async (row) => {
    const setup = paneSetup({ isAlwaysShown: true });
    setup.pane.scopeOpened('two-sum');
    await setup.answerSession('s1');
    setup.calls.length = 0;

    for (let toggle = 0; toggle < row.toggles; toggle += 1) {
      setup.pane.toggle();
    }

    expect(setup.calls).toEqual(row.calls);
    expect(setup.focus()).toBe(row.focus);
    expect(setup.pane.isShown()).toBe(true);
  });

  it.each<{
    case: string;
    scope: string | null;
    answer: string | null;
    calls: string[];
    reads: number;
    log: string;
  }>([
    {
      case: 'over the ask box gives the keys with no second read',
      scope: 'two-sum',
      answer: null,
      calls: ['tookKeys'],
      reads: 1,
      log: 'interviewer focused',
    },
    {
      case: 'with no scope gives no keys',
      scope: null,
      answer: null,
      calls: [],
      reads: 0,
      log: 'interviewer has no scope',
    },
  ])('always shown: toggle $case', async (row) => {
    const setup = paneSetup({ isAlwaysShown: true });
    if (row.scope !== null) {
      setup.pane.scopeOpened(row.scope);
      await setup.answerSession(row.answer);
    }
    setup.calls.length = 0;

    setup.pane.toggle();

    expect(setup.calls).toEqual(row.calls);
    expect(
      setup.events.filter((event) => event.startsWith('sessionOf')),
    ).toHaveLength(row.reads);
    expect(setup.logs.at(-1)).toBe(row.log);
    expect(setup.pane.isShown()).toBe(true);
  });

  it('always shown: keeps the keys on the next scope', async () => {
    const setup = paneSetup({ isAlwaysShown: true });
    setup.pane.scopeOpened('two-sum');
    await setup.answerSession('s1');
    setup.pane.toggle();
    setup.calls.length = 0;
    setup.events.length = 0;

    setup.pane.scopeOpened('lru-cache');
    await setup.answerSession(null);

    expect(setup.focus()).toBe('pane');
    expect(setup.calls).toEqual([]);
    expect(setup.events).toEqual([
      'dispose s1',
      'sessionOf lru-cache',
      'setScope ask',
      'setFocusTarget null',
      'setResizeTarget',
    ]);
    expect(setup.boxes.at(-1)!.focusOptions).toEqual([{ insertAtEnd: true }]);
  });

  it.each<{
    case: string;
    isAlwaysShown: boolean;
    answer: string | null;
    calls: string[];
    mountShown: number;
  }>([
    {
      case: 'the chat view of a shown pane',
      isAlwaysShown: true,
      answer: 's1',
      calls: ['tookKeys'],
      mountShown: 1,
    },
    {
      case: 'the ask box of a shown pane',
      isAlwaysShown: true,
      answer: null,
      calls: ['tookKeys'],
      mountShown: 0,
    },
    {
      case: 'a hidden pane',
      isAlwaysShown: false,
      answer: null,
      calls: [],
      mountShown: 0,
    },
  ])('a focus in $case while the host holds the keys', async (row) => {
    const setup = paneSetup({ isAlwaysShown: row.isAlwaysShown });
    setup.pane.scopeOpened('two-sum');
    if (row.isAlwaysShown) {
      await setup.answerSession(row.answer);
    }
    setup.calls.length = 0;

    asFake(setup.pane.element).fire('focusin', {
      target: setup.pane.element,
    });

    expect(setup.calls).toEqual(row.calls);
    expect(setup.mounts[0]?.shown ?? 0).toBe(row.mountShown);
    expect(setup.boxes.flatMap((box) => box.focusOptions)).toEqual([]);
  });

  it.each<{
    case: string;
    hasScope: boolean;
    holdsKeys: boolean;
    direction: PaneDirection;
    result: boolean;
    calls: string[];
  }>([
    {
      case: 'down from the host enters',
      hasScope: true,
      holdsKeys: false,
      direction: 'down',
      result: true,
      calls: ['tookKeys'],
    },
    {
      case: 'up from the pane leaves',
      hasScope: true,
      holdsKeys: true,
      direction: 'up',
      result: true,
      calls: ['leave'],
    },
    {
      case: 'left from the pane stays',
      hasScope: true,
      holdsKeys: true,
      direction: 'left',
      result: false,
      calls: [],
    },
    {
      case: 'right from the host stays out',
      hasScope: true,
      holdsKeys: false,
      direction: 'right',
      result: false,
      calls: [],
    },
    {
      case: 'down with no scope stays out',
      hasScope: false,
      holdsKeys: false,
      direction: 'down',
      result: false,
      calls: [],
    },
  ])('outer panes entered from below: $case', async (row) => {
    const setup = paneSetup({ isAlwaysShown: true, entersFrom: 'down' });
    if (row.hasScope) {
      setup.pane.scopeOpened('two-sum');
      await setup.answerSession('s1');
    }
    if (row.holdsKeys) {
      setup.pane.outerPanes.focus.move('down');
    }
    setup.calls.length = 0;

    const result = setup.pane.outerPanes.focus.move(row.direction);

    expect(result).toBe(row.result);
    expect(setup.calls).toEqual(row.calls);
  });

  it('opens nothing with no scope', () => {
    const setup = paneSetup();

    setup.pane.toggle();

    expect(setup.pane.isShown()).toBe(false);
    expect(setup.events).toEqual([]);
    expect(setup.toasts).toEqual([]);
    expect(setup.logs).toEqual(['interviewer has no scope']);
  });

  it.each<{
    case: string;
    hostAnswersLeave?: false;
    before: (setup: Setup) => Promise<void>;
    act: (setup: Setup) => Promise<void>;
    // The spec's calls and the log lines the act adds.
    calls: string[];
    logs: string[];
    isShown: boolean;
  }>([
    {
      case: 'open',
      before: async (setup) => setup.pane.scopeOpened('two-sum'),
      act: async (setup) => {
        setup.pane.toggle();
        await setup.answerSession(null);
      },
      calls: ['setShown true', 'tookKeys'],
      logs: [
        'interviewer pane shown',
        'interviewer ask box shown for two-sum',
        'interviewer focused',
      ],
      isShown: true,
    },
    {
      case: 'hide while holding the keys',
      before: (setup) => setup.openTwoSum(null),
      act: async (setup) => setup.pane.toggle(),
      calls: ['leave', 'setShown false'],
      logs: ['interviewer left', 'interviewer pane hidden'],
      isShown: false,
    },
    {
      case: "hide while holding the keys, the host's leave not answering",
      hostAnswersLeave: false,
      before: (setup) => setup.openTwoSum(null),
      act: async (setup) => setup.pane.toggle(),
      calls: ['leave', 'setShown false'],
      logs: ['interviewer left', 'interviewer pane hidden'],
      isShown: false,
    },
    {
      case: 'hide while not holding the keys',
      before: async (setup) => {
        await setup.openTwoSum(null);
        setup.pane.leaveBox();
      },
      act: async (setup) => setup.pane.toggle(),
      calls: ['setShown false'],
      logs: ['interviewer pane hidden'],
      isShown: false,
    },
    {
      case: 'hide before the answer lands',
      before: async (setup) => setup.pane.scopeOpened('two-sum'),
      act: async (setup) => {
        setup.pane.toggle();
        setup.pane.toggle();
        await setup.answerSession(null);
      },
      calls: ['setShown true', 'setShown false'],
      logs: [
        'interviewer pane shown',
        'interviewer pane hidden',
        'interviewer ask box shown for two-sum',
      ],
      isShown: false,
    },
  ])('toggle: $case', async (row) => {
    const setup = paneSetup({ hostAnswersLeave: row.hostAnswersLeave });
    await row.before(setup);
    setup.calls.length = 0;
    setup.logs.length = 0;

    await row.act(setup);

    expect(setup.calls).toEqual(row.calls);
    expect(setup.logs).toEqual(row.logs);
    expect(setup.pane.isShown()).toBe(row.isShown);
  });

  it.each<{
    case: string;
    leave: (pane: Setup['pane']) => void;
    // The scope open after `leave`, whose new box asks again; null for none.
    reopened: string | null;
  }>([
    {
      case: 'another scope opened',
      leave: (pane) => pane.scopeOpened('lru-cache'),
      reopened: 'lru-cache',
    },
    {
      case: 'the pane disposed',
      leave: (pane) => pane.dispose(),
      reopened: null,
    },
    {
      case: 'the scope closed and reopened as the same scope',
      leave: (pane) => {
        pane.scopeOpened(null);
        pane.scopeOpened('two-sum');
      },
      reopened: 'two-sum',
    },
  ])('drops an ask answer once $case', async (row) => {
    const setup = paneSetup();
    await setup.openTwoSum(null);
    setup.boxes[0]!.text = 'how do I start';
    setup.pane.send();
    row.leave(setup.pane);
    setup.logs.length = 0;

    await setup.answerAsk({ sessionId: 's2' });
    const mountedOnAnswer = setup.mounts.length;
    const logsOnAnswer = [...setup.logs];
    if (row.reopened !== null) {
      await setup.answerSession(null);
      setup.boxes.at(-1)!.text = 'hint please';
      setup.pane.send();
    }

    expect(mountedOnAnswer).toBe(0);
    expect(logsOnAnswer).toEqual([]);
    expect(setup.asks).toEqual(
      row.reopened === null
        ? [['two-sum', 'how do I start']]
        : [
            ['two-sum', 'how do I start'],
            [row.reopened, 'hint please'],
          ],
    );
  });

  it.each<{
    case: string;
    // What the pane shows before the refresh: the ask box, a mount of `s1`,
    // or nothing, the pane never shown.
    shows: 'box' | 'mount' | 'hidden';
    answer: string | null;
    mounts: { sessionId: string; shown: number; disposed: number }[];
    liveBoxes: number;
    events: string[];
  }>([
    {
      case: 'a host-made ask mounts its session',
      shows: 'box',
      answer: 's3',
      mounts: [{ sessionId: 's3', shown: 1, disposed: 0 }],
      liveBoxes: 0,
      events: [
        'sessionOf two-sum',
        'setScope ask',
        'setFocusTarget null',
        'setResizeTarget',
        'sessionOf two-sum',
      ],
    },
    {
      case: 'a shown mount stays',
      shows: 'mount',
      answer: 's1',
      mounts: [{ sessionId: 's1', shown: 1, disposed: 0 }],
      liveBoxes: 0,
      events: ['sessionOf two-sum', 'sessionOf two-sum'],
    },
    {
      case: 'a mount of another session remounts',
      shows: 'mount',
      answer: 's2',
      mounts: [
        { sessionId: 's1', shown: 1, disposed: 1 },
        { sessionId: 's2', shown: 1, disposed: 0 },
      ],
      liveBoxes: 0,
      events: ['sessionOf two-sum', 'sessionOf two-sum', 'dispose s1'],
    },
    {
      case: 'hidden asks nothing',
      shows: 'hidden',
      answer: null,
      mounts: [],
      liveBoxes: 0,
      events: [],
    },
  ])('refresh: $case', async (row) => {
    const setup = paneSetup();
    if (row.shows === 'hidden') {
      setup.pane.scopeOpened('two-sum');
    } else {
      await setup.openTwoSum(row.shows === 'mount' ? 's1' : null);
    }

    setup.pane.refresh();
    if (row.shows !== 'hidden') {
      await setup.answerSession(row.answer);
    }

    expect(setup.mounts).toEqual(
      row.mounts.map((mount) => expect.objectContaining(mount)),
    );
    expect(liveBoxCount(setup)).toBe(row.liveBoxes);
    expect(setup.events).toEqual(row.events);
  });
});
