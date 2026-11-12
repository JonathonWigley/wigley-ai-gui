import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable, Registrations } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { asFake, installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  fakeDependency,
  noCounts,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import type { AgentPane, ScopedAgentsPageExports } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import { scopedAgentsPagePart } from './start';

// One ask box the fake editor host made: its text and whether it was
// destroyed.
interface FakeBox {
  text: string;
  isDestroyed: boolean;
}

// One `mountChat` call and how often its handle was disposed.
interface FakeMount {
  sessionId: string;
  disposed: number;
}

// The page part on the harness, drawing its layout for real. Main answers
// `sessionOf` with `sessions[agentId]`, null for an agent it lacks, and `ask`
// with `s9`; `invokes` holds each invoke's method and arguments. `boxes` holds
// each ask box made, `mounts` each chat view mounted. `addPane` adds a pane
// for `consumer`, opens `scope` in it and returns it with its spec's calls:
// `tookKeys`, and `leave`, which tells the pane the host took the keys.
function startScopedAgentsPage(sessions: Record<string, string> = {}) {
  const invokes: unknown[][] = [];
  const boxes: FakeBox[] = [];
  const mounts: FakeMount[] = [];
  const editor: EditorHost = {
    ...countingEditors().host,
    create() {
      const box: FakeBox = { text: '', isDestroyed: false };
      boxes.push(box);
      return {
        text: () => box.text,
        setText: (text: string) => {
          box.text = text;
        },
        insert: () => undefined,
        charBeforeCursor: () => '',
        focus: () => undefined,
        blur: () => undefined,
        destroy: () => {
          box.isDestroyed = true;
        },
      };
    },
  };
  const harness = startDrawingPagePart(scopedAgentsPagePart, {
    services: { editor },
    dependencies: [
      fakeDependency(
        chatPageKey,
        () =>
          ({
            mountChat(_element: HTMLElement, sessionId: string) {
              const mount: FakeMount = { sessionId, disposed: 0 };
              mounts.push(mount);
              return {
                shown: () => undefined,
                hidden: () => undefined,
                dispose: () => {
                  mount.disposed += 1;
                },
              };
            },
          }) as unknown as ChatPageExports,
      ),
    ],
    invoke: async (method, ...args) => {
      invokes.push([method, ...args]);
      if (method === 'sessionOf') {
        return sessions[args[1] as string] ?? null;
      }
      return 's9';
    },
  });
  const tracked: Disposable[] = [];
  const consumer: Registrations = {
    track(handle) {
      tracked.push(handle);
      return handle;
    },
  };
  const exports = harness.started().exports!(
    consumer,
  ) as ScopedAgentsPageExports;
  const addPane = (owner: string, agentId: string, scope: string) => {
    const calls: string[] = [];
    const held: { pane: AgentPane | null } = { pane: null };
    const pane = exports.addAgentPane({
      owner,
      agentId,
      heading: () => agentId,
      hint: `Ask the ${agentId}.`,
      setShown: () => undefined,
      resizeTarget: { nudge: () => true },
      tookKeys: () => calls.push('tookKeys'),
      leave() {
        calls.push('leave');
        held.pane?.hostTookKeys();
      },
    });
    held.pane = pane;
    pane.scopeOpened(scope);
    return { pane, calls };
  };
  const run = (command: 'askSend' | 'leaveBox') =>
    harness.started().commands[command]({ arg: undefined });
  const asks = () => invokes.filter(([method]) => method === 'ask');
  return { harness, boxes, mounts, tracked, addPane, run, asks };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const leavesIn = (calls: readonly string[]) =>
  calls.filter((call) => call === 'leave').length;

describe('scoped-agents page part', () => {
  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the focus in the ask box across a layout change', async () => {
    const page = startScopedAgentsPage();
    const { pane } = page.addPane('practice', 'interviewer', 'two-sum');
    pane.toggle();
    await settle();
    const askBox = asFake(pane.element).querySelector('.scoped-agents-ask-box');
    const content = document.createElement('div');
    askBox!.append(asFake(content));
    content.focus();

    page.harness.showLayouts({
      layouts: new Map([['default', defaultLayout]]),
      user: 'default',
    });

    expect(document.activeElement === content).toBe(true);
  });

  it('askSend sends from the pane that holds the keys', async () => {
    const page = startScopedAgentsPage();
    const interviewer = page.addPane('practice', 'interviewer', 'two-sum');
    const assistant = page.addPane('backlog', 'assistant', 'global');
    page.run('askSend');
    const asksWithNoneHolding = page.asks();

    interviewer.pane.toggle();
    await settle();
    assistant.pane.toggle();
    await settle();
    page.boxes[0]!.text = 'how do I start';
    page.boxes[1]!.text = 'which items are stale';
    page.run('askSend');

    expect(asksWithNoneHolding).toEqual([]);
    expect(page.asks()).toEqual([
      ['ask', 'backlog', 'assistant', 'global', 'which items are stale'],
    ]);
  });

  it('the toggled pane sets the ask scope', async () => {
    const page = startScopedAgentsPage();
    const { pane } = page.addPane('practice', 'interviewer', 'two-sum');

    pane.toggle();
    await settle();

    expect(page.harness.scope()).toBe('scoped-agents.ask');
  });

  it.each<{
    case: string;
    giveUp: (pane: AgentPane) => void;
    // Run after the commands: the dispose row disposes a second time.
    after: (pane: AgentPane) => void;
    liveBoxes: number;
  }>([
    {
      case: 'hostTookKeys',
      giveUp: (pane) => pane.hostTookKeys(),
      after: () => undefined,
      liveBoxes: 1,
    },
    {
      case: 'modeHidden',
      giveUp: (pane) => pane.modeHidden(),
      after: () => undefined,
      liveBoxes: 1,
    },
    {
      case: 'dispose',
      giveUp: (pane) => pane.dispose(),
      after: (pane) => pane.dispose(),
      liveBoxes: 0,
    },
  ])(
    'askSend does nothing once the pane gave up the keys: $case',
    async (row) => {
      const page = startScopedAgentsPage();
      const { pane, calls } = page.addPane(
        'practice',
        'interviewer',
        'two-sum',
      );
      pane.toggle();
      await settle();
      page.boxes[0]!.text = 'how do I start';
      row.giveUp(pane);
      const leaves = leavesIn(calls);

      page.run('askSend');
      page.run('leaveBox');
      row.after(pane);
      await settle();

      expect(page.asks()).toEqual([]);
      expect(leavesIn(calls)).toBe(leaves);
      expect(page.boxes.filter((box) => !box.isDestroyed)).toHaveLength(
        row.liveBoxes,
      );
    },
  );

  it("a consumer's stop disposes its panes", async () => {
    const page = startScopedAgentsPage({ assistant: 's1' });
    const interviewer = page.addPane('practice', 'interviewer', 'two-sum');
    const assistant = page.addPane('backlog', 'assistant', 'global');
    interviewer.pane.toggle();
    await settle();
    assistant.pane.toggle();
    await settle();

    for (const handle of page.tracked) {
      handle.dispose();
    }

    expect(
      asFake(interviewer.pane.element).querySelector('.scoped-agents-ask-box'),
    ).toBeNull();
    expect(page.boxes.map((box) => box.isDestroyed)).toEqual([true]);
    expect(page.mounts).toEqual([{ sessionId: 's1', disposed: 1 }]);
  });

  it('stops with nothing live', async () => {
    const page = startScopedAgentsPage({ assistant: 's1' });
    const interviewer = page.addPane('practice', 'interviewer', 'two-sum');
    const assistant = page.addPane('backlog', 'assistant', 'global');
    interviewer.pane.toggle();
    await settle();
    assistant.pane.toggle();
    await settle();

    await page.harness.stop();

    expect(page.harness.counts()).toEqual(noCounts);
  });
});
