import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { escapeRegExp } from '../../../shared/escape-reg-exp';
import type { DemoRunReport } from '../contract';

// `open` tells the page a self-test run opened; `nextReport` resolves with the page's next report.
export interface DemoSelfTestDeps {
  open(run: number): void;
  nextReport(): Promise<DemoRunReport>;
}

const line = (text: string) => `[demo] ${text}`;
const DEMO_KEYS = (key: string) => [' ', 'd', key];
// The first two steps in run order: section `shell`, lowest `order`.
const FIRST = 'keys.hints';
const SECOND = 'gallery.mode';
// The last beat before the `live` section: the highest-order `bars` step's last beat.
const LAST_STEP = 'auto-retro.section';
const LAST_LINE = line(
  `showing ${LAST_STEP} beat 1 of 1: Retro running, 2 queued`,
);

const firstBeatShown = (stepId: string) =>
  new RegExp(`^\\[demo\\] showing ${escapeRegExp(stepId)} beat 1 of \\d+: .+$`);
const cursorOn = (stepId: string) =>
  new RegExp(`^\\[demo\\] cursor on ${escapeRegExp(stepId)}$`);

// One problem per missing plugin, then one per failed step, in report order.
export function reportProblems(report: DemoRunReport): string[] {
  return [
    ...report.missing.map((id) => `${id} has no demo step and no demoSkip`),
    ...report.failed.map((stepId) => `step ${stepId} failed`),
  ];
}

// Runs a demo through its Space d keys and the panel, walks every step before the `live` section, and stops; the
// result is the page's report at that stop. The script runs after every other plugin's but app-update's.
export function demoSelfTestScript(deps: DemoSelfTestDeps): SelfTestScript {
  const groups: SelfTestGroup[] = [
    {
      name: 'start',
      why: 'Space d d starts a run on the first step, fitting the window.',
      steps: [
        {
          keys: DEMO_KEYS('d'),
          expect: line('run started'),
          alsoExpect: [firstBeatShown(FIRST)],
          screenshot: 'started',
          checksFit: true,
        },
      ],
    },
    {
      name: 'first-beat',
      why: 'Space d p on the first beat of the first step stays there.',
      steps: [{ keys: DEMO_KEYS('p'), expect: line('at the first beat') }],
    },
    {
      name: 'panel',
      why: 'Alt+l reaches the Demo panel at the top of the right bar with the cursor on the held step; j and Enter go to the next step, and Alt+h gives the keys back.',
      steps: [
        {
          // Presses past the panel only log `no pane right`, so three reach it from a Chat tab with its hub and one more pane.
          keys: ['<A-l>', '<A-l>', '<A-l>'],
          expect: line('panel focused'),
          alsoExpect: [cursorOn(FIRST)],
        },
        { keys: ['j'], expect: line(`cursor on ${SECOND}`) },
        {
          keys: ['Enter'],
          expect: line(`went to ${SECOND}`),
          alsoExpect: [firstBeatShown(SECOND)],
          screenshot: 'panel-cursor',
        },
        { keys: ['<A-h>'], expect: '[page] focus back in main' },
      ],
    },
    {
      name: 'reset',
      why: 'Space d r enters the held step again.',
      steps: [{ keys: DEMO_KEYS('r'), expect: line(`reset ${SECOND}`) }],
    },
    {
      name: 'real-sessions',
      why: 'Space d h shows the real sessions beside the Demo section and hides them again.',
      steps: [
        { keys: DEMO_KEYS('h'), expect: line('real sessions shown') },
        { keys: DEMO_KEYS('h'), expect: line('real sessions hidden') },
      ],
    },
    {
      name: 'autoplay',
      why: 'Space d a turns autoplay on, which moves on once the 1 s dwell passes, and off again.',
      steps: [
        {
          keys: DEMO_KEYS('a'),
          expect: line('autoplay on'),
          alsoExpect: [/^\[demo\] moved next$/],
        },
        { keys: DEMO_KEYS('a'), expect: line('autoplay off') },
      ],
    },
    {
      name: 'walk',
      why: 'Space d n walks every step before the live section, entering and leaving each, so a step that throws reaches the report.',
      steps: [
        {
          keys: DEMO_KEYS('n'),
          expect: line('moved next'),
          repeat: { until: LAST_LINE, max: 400 },
          timeoutMs: 15000,
        },
        {
          keys: DEMO_KEYS('r'),
          expect: line(`reset ${LAST_STEP}`),
          screenshot: 'before-live',
        },
      ],
    },
    {
      name: 'stop',
      why: 'Space d x stops the run, logging the coverage check.',
      steps: [
        {
          keys: DEMO_KEYS('x'),
          expect: line('run stopped'),
          alsoExpect: [/^\[demo\] coverage: /],
        },
      ],
    },
  ];

  return {
    pageBinds: [],
    settings: { demo: { autoplaySeconds: 1 } },
    // The status bar caption cuts its text with an ellipsis.
    scrollsItself: ['.demo-caption-text'],
    open(run) {
      deps.open(run);
      return {
        shownLine: line(`self-test run ${run}`),
        result: deps.nextReport(),
      };
    },
    groups,
    problems: (result) => reportProblems(result as DemoRunReport),
  };
}
