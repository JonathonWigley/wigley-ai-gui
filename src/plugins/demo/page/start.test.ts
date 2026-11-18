import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  corePluginsSlot,
  type PluginStatus,
} from '../../../contracts/core-state';
import type { DemoStep } from '../../../contracts/demo';
import type { EditorHost } from '../../../contracts/editor';
import type { BarOptions } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type AgentPane,
  type ScopedAgentsPageExports,
  scopedAgentsPageKey,
} from '../../scoped-agents/contract';
import {
  type SessionRow,
  type SessionsPageExports,
  type SidebarSection,
  sessionsPageKey,
} from '../../sessions/contract';
import { demoPagePart } from './start';

const SCRATCH = '/scratch';

// A shell step whose enter and dispose record into `events`, each beat showing nothing.
function fakeStep(
  events: string[],
  id: string,
  order: number,
  beats: string[],
): DemoStep {
  return {
    id,
    section: 'shell',
    order,
    title: `${id} title`,
    caption: `${id} caption`,
    files: [],
    async enter() {
      events.push(`enter ${id}`);
      return {
        beats: beats.map((name) => ({ name, show() {} })),
        dispose: () => void events.push(`dispose ${id}`),
      };
    },
  };
}

function pluginStatus(id: string): PluginStatus {
  return {
    id,
    label: id,
    description: '',
    on: true,
    neededBy: [],
    origin: 'built-in',
    problem: null,
    demoSkip: null,
  };
}

interface Contribution {
  area: 'panel' | 'caption';
  options: BarOptions | undefined;
  isLive: boolean;
}

// Lets the work a command did not await, such as `ready`'s stop, run to its end.
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The demo page part over fake `sessions` and `scoped-agents` exports and a fake channel, with the steps `p.one`
// (beats one-a, one-b) and `p.two` (beat two-a) registered beside its own real-session step. `events` holds, in
// order: each channel call but `describeStep` as `invoke <method>[ <step id>]`, `addSection <id>`,
// `showOnly <id>` and the dispose of each, each step's enter and dispose, and each left-bar (`panel`) and status-bar
// (`caption`) contribution and its dispose. `reports` holds each `report` invoke's argument. `start`, `stop` and
// `enterStep` answer main's methods of those names.
function startDemo({
  start = async () => ({ scratchDir: SCRATCH }),
  stop = async () => undefined,
  enterStep = async () => ({}),
}: {
  start?: () => Promise<{ scratchDir: string }>;
  stop?: () => Promise<void>;
  enterStep?: () => Promise<object>;
} = {}) {
  const events: string[] = [];
  const reports: unknown[] = [];
  const sections: SidebarSection[] = [];
  const contributions: Contribution[] = [];
  const scopes: (string | null)[] = [];
  const sessions = fakeDependency(
    sessionsPageKey,
    () =>
      ({
        addSection(section: SidebarSection) {
          sections.push(section);
          events.push(`addSection ${section.id}`);
          return { dispose: () => void events.push('dispose section') };
        },
        showOnly(sectionId: string) {
          events.push(`showOnly ${sectionId}`);
          return { dispose: () => void events.push('dispose showOnly') };
        },
        activate() {},
      }) as unknown as SessionsPageExports,
  );
  const scopedAgents = fakeDependency(
    scopedAgentsPageKey,
    (): ScopedAgentsPageExports => ({
      addAgentPane: () =>
        ({
          element: document.createElement('div'),
          isShown: () => true,
          toggle: () => void events.push('pane toggle'),
          scopeOpened: (scope: string | null) => void scopes.push(scope),
          refresh() {},
          hostTookKeys() {},
          holdsKeys: () => false,
          modeHidden() {},
          redraw() {},
          dispose() {},
        }) as unknown as AgentPane,
    }),
  );
  const demoSteps = createDemoStepRegistry<DemoStep>();
  demoSteps.register(fakeStep(events, 'p.one', 1, ['one-a', 'one-b']));
  demoSteps.register(fakeStep(events, 'p.two', 2, ['two-a']));
  const record =
    (
      area: Contribution['area'],
      contribute: (
        element: HTMLElement,
        options?: BarOptions,
      ) => { dispose(): void },
    ) =>
    (element: HTMLElement, options?: BarOptions) => {
      const live = contribute(element, options);
      const contribution: Contribution = { area, options, isLive: true };
      contributions.push(contribution);
      events.push(`contribute ${area}`);
      return {
        dispose() {
          if (contribution.isLive) {
            contribution.isLive = false;
            events.push(`dispose ${area}`);
          }
          live.dispose();
        },
      };
    };
  const part: typeof demoPagePart = {
    ...demoPagePart,
    start: (api) =>
      demoPagePart.start({
        ...api,
        areas: {
          ...api.areas,
          leftBar: {
            contribute: record('panel', api.areas.leftBar.contribute),
          },
          statusBar: {
            contribute: record('caption', api.areas.statusBar.contribute),
          },
        },
      }),
  };
  const harness = startPagePart(part, {
    dependencies: [sessions, scopedAgents],
    services: {
      demoSteps,
      editor: { contains: () => false } as unknown as EditorHost,
    },
    async invoke(method, ...args) {
      if (method !== 'describeStep') {
        const stepId = typeof args[0] === 'string' ? ` ${args[0]}` : '';
        events.push(`invoke ${method}${stepId}`);
      }
      if (method === 'start') {
        return start();
      }
      if (method === 'stop') {
        return stop();
      }
      if (method === 'enterStep') {
        return enterStep();
      }
      if (method === 'report') {
        reports.push(args[0]);
      }
      return undefined;
    },
  });
  const commands = () => harness.started().commands;
  const messages = () =>
    harness.logs
      .filter(({ source }) => source === 'demo')
      .map(({ message }) => message);
  const panel = () =>
    contributions.findLast(({ area }) => area === 'panel') ?? null;
  const live = (area: Contribution['area']) =>
    contributions.some((each) => each.area === area && each.isLive);
  return {
    harness,
    commands,
    messages,
    events,
    reports,
    demoSteps,
    sections,
    scopes,
    panel,
    live,
  };
}

type Demo = ReturnType<typeof startDemo>;

async function startRun(demo: Demo) {
  await demo.commands().togglePanel({ arg: undefined });
}

describe('demoPagePart', () => {
  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('togglePanel_NoRun_StartsTheRun', async () => {
    const demo = startDemo();

    await startRun(demo);

    const section = demo.sections[0];
    const rows = [
      { harness: 'demo', projectDir: '/home/project' },
      { harness: 'claude-code', projectDir: SCRATCH },
      { harness: 'claude-code', projectDir: '/home/project' },
    ] as SessionRow[];
    expect({
      order: demo.events.filter((event) =>
        /^(invoke|addSection|showOnly)/.test(event),
      ),
      claims: rows.map((row) => section.claims(row)),
    }).toEqual({
      order: [
        'invoke start',
        'addSection demo',
        'showOnly demo',
        'invoke enterStep p.one',
      ],
      claims: [true, true, false],
    });
  });

  it('stop_Run_LeavesPageStageThenMainThenDisposesHolds', async () => {
    const demo = startDemo();
    await startRun(demo);
    demo.events.length = 0;

    await demo.commands().stop({ arg: undefined });

    expect({
      events: demo.events,
      lastLog: demo.messages().at(-1),
    }).toEqual({
      events: [
        'invoke report',
        'dispose p.one',
        'invoke leaveStep p.one',
        'invoke stop',
        'dispose showOnly',
        'dispose section',
        'dispose panel',
        'dispose caption',
      ],
      lastLog: 'run stopped',
    });
  });

  it('showReal_Twice_DisposesThenRetakesTheHold', async () => {
    const demo = startDemo();
    await startRun(demo);
    demo.events.length = 0;
    const mark = demo.messages().length;

    await demo.commands().showReal({ arg: undefined });
    await demo.commands().showReal({ arg: undefined });

    expect({
      events: demo.events,
      logs: demo.messages().slice(mark),
    }).toEqual({
      events: ['dispose showOnly', 'showOnly demo'],
      logs: ['real sessions shown', 'real sessions hidden'],
    });
  });

  it.each<'next' | 'previous' | 'reset' | 'autoplay' | 'showReal' | 'stop'>([
    'next',
    'previous',
    'reset',
    'autoplay',
    'showReal',
    'stop',
  ])('command_NoRun_LogsNotRunning: %s', async (command) => {
    const demo = startDemo();

    await demo.commands()[command]({ arg: undefined });

    expect({ events: demo.events, logs: demo.messages() }).toEqual({
      events: [],
      logs: ['the demo is not running'],
    });
  });

  it('togglePanel_TwiceWhileStarting_StartsOnce', async () => {
    const mainStart = deferred<{ scratchDir: string }>();
    const demo = startDemo({ start: () => mainStart.promise });

    const first = demo.commands().togglePanel({ arg: undefined });
    const second = demo.commands().togglePanel({ arg: undefined });
    await settled();
    mainStart.resolve({ scratchDir: SCRATCH });
    await Promise.all([first, second]);

    expect({
      starts: demo.events.filter((event) => event === 'invoke start').length,
      sections: demo.sections.length,
      logs: demo
        .messages()
        .filter((line) => line === 'run started' || line === 'panel hidden'),
    }).toEqual({
      starts: 1,
      sections: 1,
      logs: ['run started', 'panel hidden'],
    });
  });

  it('start_Rejects_ToastsAndAddsNothing', async () => {
    const demo = startDemo({
      start: async () => {
        throw new Error('no scratch folder');
      },
    });

    await startRun(demo);

    expect({ events: demo.events, logs: demo.messages() }).toEqual({
      events: ['invoke start'],
      logs: [
        'start failed: no scratch folder',
        'toast error: The demo did not start: no scratch folder',
      ],
    });
  });

  it.each<{ name: string; stop(): Promise<void>; expectedLogs: string[] }>([
    { name: 'none left', stop: async () => undefined, expectedLogs: [] },
    {
      name: 'stop rejects',
      stop: async () => {
        throw new Error('main is gone');
      },
      expectedLogs: ['stopping a leftover run failed: main is gone'],
    },
  ])('ready_StopsALeftoverRun: $name', async ({ stop, expectedLogs }) => {
    const demo = startDemo({ stop });

    demo.harness.ready();
    await settled();

    expect({ events: demo.events, logs: demo.messages() }).toEqual({
      events: ['invoke stop'],
      logs: expectedLogs,
    });
  });

  it('panelToggle_HideShow_KeepsTheRun', async () => {
    const demo = startDemo();
    await startRun(demo);
    const mark = demo.messages().length;

    await demo.commands().togglePanel({ arg: undefined });
    const hidden = {
      panel: demo.live('panel'),
      caption: demo.live('caption'),
    };
    await demo.commands().next({ arg: undefined });
    await demo.commands().togglePanel({ arg: undefined });

    expect({
      hidden,
      shownAgain: demo.live('panel'),
      logs: demo
        .messages()
        .slice(mark)
        .filter((line) => !line.startsWith('showing ')),
    }).toEqual({
      hidden: { panel: false, caption: true },
      shownAgain: true,
      logs: ['panel hidden', 'moved next', 'panel shown'],
    });
  });

  it.each<{
    name: string;
    isRunning: boolean;
    stepId: string;
    expected: { invokes: string[]; error: string | null };
  }>([
    {
      name: 'no run',
      isRunning: false,
      stepId: 'p.two',
      expected: {
        invokes: ['invoke start', 'invoke enterStep p.two'],
        error: null,
      },
    },
    {
      name: 'an unknown id on a live run',
      isRunning: true,
      stepId: 'nope',
      expected: { invokes: [], error: 'No demo step nope.' },
    },
  ])(
    'goTo_NoRunOrUnknownId_StartsOrRejects: $name',
    async ({ isRunning, stepId, expected }) => {
      const demo = startDemo();
      if (isRunning) {
        await startRun(demo);
      }
      demo.events.length = 0;

      let error: string | null = null;
      try {
        await demo.commands().goTo({ arg: stepId });
      } catch (thrown) {
        error = (thrown as Error).message;
      }

      expect({
        invokes: demo.events.filter((event) => event.startsWith('invoke ')),
        error,
      }).toEqual(expected);
    },
  );

  it.each<{
    name: string;
    act(demo: Demo): void | Promise<void>;
    expectedLogs: string[];
  }>([
    {
      name: 'focus puts the cursor on the held step',
      act: () => undefined,
      expectedLogs: ['panel focused', 'cursor on p.one'],
    },
    {
      name: 'cursorDown',
      act: (demo) => demo.commands().cursorDown({ arg: undefined }),
      expectedLogs: ['panel focused', 'cursor on p.one', 'cursor on p.two'],
    },
    {
      name: 'cursorUp at the first step',
      act: (demo) => demo.commands().cursorUp({ arg: undefined }),
      expectedLogs: ['panel focused', 'cursor on p.one', 'cursor on p.one'],
    },
    {
      name: 'goToCursor with the cursor on the second step',
      act: async (demo) => {
        await demo.commands().cursorDown({ arg: undefined });
        await demo.commands().goToCursor({ arg: undefined });
      },
      expectedLogs: [
        'panel focused',
        'cursor on p.one',
        'cursor on p.two',
        'showing p.two beat 1 of 1: two-a',
        'went to p.two',
      ],
    },
  ])('panelCommands_MoveCursorAndGo: $name', async ({ act, expectedLogs }) => {
    const demo = startDemo();
    await startRun(demo);
    const mark = demo.messages().length;

    demo.panel()?.options?.focus?.();
    await act(demo);

    expect(demo.messages().slice(mark)).toEqual(expectedLogs);
  });

  // Breaks on a demo that leaves a box the user was typing in holding the focus, whose insert mode types the next
  // `<Leader>d` keys as text.
  it.each<{ name: string; act(demo: Demo): void | Promise<void> }>([
    {
      name: 'the next beat',
      act: (demo) => demo.commands().next({ arg: undefined }),
    },
    {
      name: 'leaving one step and entering another',
      act: (demo) => demo.commands().goTo({ arg: 'p.two' }),
    },
  ])(
    'beatOrLeave_BoxFocusedBefore_TakesTheKeysBack: $name',
    async ({ act }) => {
      const demo = startDemo();
      await startRun(demo);
      // The fake DOM has no `matches`, so the box reads as a text box by `isContentEditable`.
      const box = Object.assign(document.createElement('div'), {
        isContentEditable: true,
      });
      box.focus();

      await act(demo);

      expect({
        isFocused: document.activeElement === box,
        tookKeys: demo
          .messages()
          .includes('took the keys back from a text box'),
      }).toEqual({ isFocused: false, tookKeys: true });
    },
  );

  // Breaks when the run takes the keys back only once a step's enter returns: main's half of the first step can be
  // slow or fail, and a box left focused meanwhile types the next `<Leader>d` keys as text.
  it('start_BoxFocusedWhileTheFirstStepIsPending_TakesTheKeysBack', async () => {
    const pending = deferred<object>();
    const demo = startDemo({ enterStep: () => pending.promise });
    const box = Object.assign(document.createElement('div'), {
      isContentEditable: true,
    });
    box.focus();

    const running = startRun(demo);
    await settled();

    expect(document.activeElement === box).toBe(false);
    pending.resolve({});
    await running;
  });

  it('stop_FailedStep_ReportsCoverageAndFailures', async () => {
    const demo = startDemo();
    demo.harness.state
      .publish(corePluginsSlot)
      .set([pluginStatus('p'), pluginStatus('x')]);
    demo.demoSteps.register({
      ...fakeStep(demo.events, 'p.bad', 0, ['bad']),
      enter: async () => {
        throw new Error('no sample data');
      },
    });
    await startRun(demo);
    await demo.commands().next({ arg: undefined });
    demo.events.length = 0;

    await demo.commands().stop({ arg: undefined });

    expect({
      reports: demo.reports,
      firstEvents: demo.events.slice(0, 3),
      logs: demo
        .messages()
        .filter((line) => /^(coverage|failed steps):/.test(line)),
    }).toEqual({
      reports: [{ missing: ['x'], failed: ['p.bad'] }],
      firstEvents: ['invoke report', 'dispose p.one', 'invoke leaveStep p.one'],
      logs: ['coverage: no step or skip for x', 'failed steps: p.bad'],
    });
  });

  it('stop_Run_ClosesThePaneScope', async () => {
    const demo = startDemo();
    await startRun(demo);

    await demo.commands().stop({ arg: undefined });

    expect({
      opened: demo.scopes.includes('p.one'),
      last: demo.scopes.at(-1),
    }).toEqual({ opened: true, last: null });
  });
});
