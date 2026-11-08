import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type {
  ConnectedSession,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { PrimerItem, PrimerPayload } from '../contract';
import { openFixturePrimer, SAMPLE_PRIMER_ARGS } from './fixtures';

// The sample primer under its self-test name; the run number in the summary
// changes its fingerprint, so a later run does not pre-fill from this one.
function selfTestPrimer(run: number) {
  return {
    ...SAMPLE_PRIMER_ARGS,
    feature: {
      ...SAMPLE_PRIMER_ARGS.feature,
      name: 'Self-test primer',
      summary: `Self-test run ${run}.`,
    },
  };
}

// From the Feature row in the tasks column: task 1 needs no; task 2 is
// selected, and from the items column it needs yes and its second item is left
// out; back in the tasks column task 3 is unclear. On task 2's second item
// card, the item is toggled back and forth and its comment box reached; ⌃H
// steps the items column; `a` adds `Polish` on the task card, `C` reaches the
// task's comment, and ⌃H then steps the tasks column to task 1 before focus
// returns to the items and the tasks column.
const PRIMER_STEPS: SelfTestStep[] = [
  {
    keys: ['j'],
    expect: '[page] j ran primer.nextRow',
    checksFit: true,
    screenshot: 'tasks',
  },
  { keys: ['n'], expect: '[page] n ran primer.needNo' },
  { keys: ['j'], expect: '[primer] selected task 2' },
  {
    keys: ['<A-l>'],
    expect: '[page] <A-l> ran panes.focusRight',
    checksFit: true,
    screenshot: 'items',
  },
  {
    keys: ['y'],
    expect: '[primer] need yes on task 2',
    why: "A need key in the items column sets its task's need.",
  },
  { keys: ['j'], expect: '[primer] selected item 2 on task 2' },
  { keys: ['x'], expect: '[primer] left out item 2 on task 2' },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
  { keys: ['j'], expect: '[primer] selected task 3' },
  { keys: ['u'], expect: '[page] u ran primer.needUnclear' },
  {
    keys: ['k'],
    expect: '[primer] selected task 2',
    why: 'Selecting a task selects its first item.',
  },
  { keys: ['<A-l>'], expect: '[page] <A-l> ran panes.focusRight' },
  { keys: ['j'], expect: '[primer] selected item 2 on task 2' },
  {
    keys: ['<A-l>'],
    expect: '[page] <A-l> ran panes.focusRight',
    checksFit: true,
    screenshot: 'item-card',
  },
  { keys: ['x'], expect: '[primer] included item 2 on task 2' },
  { keys: ['x'], expect: '[primer] left out item 2 on task 2' },
  { keys: ['c'], expect: '[primer] focused comment on item 2 of task 2' },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  {
    keys: ['<C-h>'],
    expect: '[primer] selected item 1 on task 2',
    why: 'The card steps the column it came from.',
  },
  {
    keys: ['a', 'P', 'o', 'l', 'i', 's', 'h', 'Escape', 'Escape'],
    expect: '[primer] added item 3 on task 2',
    why: "a on an item card shows its task's card and focuses the add-item box; leaving the box adds the item.",
  },
  { keys: ['C'], expect: '[primer] focused comment on task 2' },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  {
    keys: ['<C-h>'],
    expect: '[primer] selected task 1',
    checksFit: true,
    screenshot: 'task-card',
    why: 'The task card steps the tasks column.',
  },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
];

// An extra task added from the tasks column and removed again, so the
// submitted payload holds only the sent tasks.
const EXTRA_TASK_STEPS: SelfTestStep[] = [
  {
    keys: ['A'],
    expect: '[primer] added extra task extra-1',
    checksFit: true,
  },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
  { keys: ['D'], expect: '[primer] removed extra task extra-1' },
];

// The review opens, closes and opens again; the cancel prompt opens from the
// review's cancel key and from closing the session, and is dismissed each
// time; the review submits, which closes the session's row.
const REVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', ' '],
    expect: '[primer] review opened',
    checksFit: true,
    screenshot: 'review',
  },
  { keys: ['Escape'], expect: '[primer] review closed' },
  { keys: [' ', ' '], expect: '[primer] review opened' },
  { keys: ['C'], expect: '[page] C ran primer.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran primer.dismissConfirm' },
  {
    keys: ['<D-w>'],
    expect:
      '[primer] closing the session asks to cancel primer-selftest · Self-test primer',
  },
  { keys: ['Escape'], expect: '[page] Escape ran primer.dismissConfirm' },
  {
    keys: ['<D-Enter>'],
    expect: '[primer] submitted',
    alsoExpect: [/^\[sessions\] activated Layout preview$/],
    why: "Sending closes the session's row, which selects its left neighbour, the Layout preview session forms' script reopened last.",
  },
];

// The sample primer opens in a session of its own and its row is selected;
// the tasks and items columns, a task card and the review draw through the
// default layout; the sample is cancelled, which closes its session.
const PREVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'p'],
    expect: '[sessions] activated Primer preview',
    checksFit: true,
    screenshot: 'preview',
  },
  {
    keys: ['j'],
    expect: '[page] j ran primer.nextRow',
    checksFit: true,
    screenshot: 'preview-task-card',
    why: 'The task card shows while the tasks column has focus.',
  },
  {
    keys: [' ', ' '],
    expect: '[primer] review opened',
    screenshot: 'preview-review',
  },
  { keys: ['C'], expect: '[page] C ran primer.askCancel' },
  { keys: ['y'], expect: '[primer] cancelled' },
];

const EXPECTED_NEEDS = ['no', 'yes', 'unclear', 'yes'];

const EXPECTED_SCREEN_ITEMS: PrimerItem[] = [
  { text: 'Draw the screen', include: true, comment: '', added: false },
  { text: 'Wire its buttons', include: false, comment: '', added: false },
  { text: 'Polish', include: true, comment: '', added: true },
];

// The primer the script opened and the run that opened it.
interface PrimerSelfTestResult {
  run: number;
  result: ToolResult;
}

function payloadProblems(payload: PrimerPayload, run: number): string[] {
  const entries = payload.entries ?? [];
  const needs = entries.map((entry) => entry.need);
  const screenItems = entries.find((entry) => entry.id === '2')?.items;
  const summary = payload.feature?.summary;
  const checks: [boolean, string][] = [
    [payload.outcome === 'submitted', `outcome ${payload.outcome}`],
    [
      payload.summary === '4 entries: 2 yes, 1 unclear, 1 no; 0 comments.',
      `summary ${JSON.stringify(payload.summary)}`,
    ],
    [
      JSON.stringify(needs) === JSON.stringify(EXPECTED_NEEDS),
      `needs ${JSON.stringify(needs)}`,
    ],
    [
      JSON.stringify(screenItems) === JSON.stringify(EXPECTED_SCREEN_ITEMS),
      `entry 2 items ${JSON.stringify(screenItems)}`,
    ],
    [
      summary === `Self-test run ${run}.`,
      `feature summary ${JSON.stringify(summary)}`,
    ],
  ];
  return checks.filter(([passed]) => !passed).map(([, problem]) => problem);
}

// Each run ends the session the run before connected, connects
// `primer-selftest-<run>` in project `primer-selftest`, activates its row so
// the steps start in its Primer popup whatever session the earlier scripts
// left selected, and opens the self-test primer there; the script checks the
// payload that call returns once the steps submit it.
export function primerSelfTestScript(
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>,
): SelfTestScript {
  let connected: ConnectedSession | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open(run) {
      connected?.end();
      const session = sessions.connect({
        sessionId: `primer-selftest-${run}`,
        projectDir: 'primer-selftest',
        harness: 'claude',
        deadlineSeconds: 120,
      });
      connected = session;
      sessions.activate(session.session.id);
      const result: Promise<PrimerSelfTestResult> = openFixturePrimer(
        session,
        selfTestPrimer(run),
      ).then((result) => ({ run, result }));
      return {
        shownLine: '[primer] form shown: primer-selftest · Self-test primer',
        result,
      };
    },
    groups: [
      {
        name: 'primer',
        why: "The Primer popup's tasks column selects a task and its items column lists that task's items; needs are set and items toggled from both columns and the item card, ⌃H on the card steps the column it came from, ⌥H and ⌥L move focus between the columns and the card, and the task's boxes are reached from an item card; the agent gets every change back once the review submits.",
        steps: PRIMER_STEPS,
      },
      {
        name: 'extra task',
        why: 'A in the tasks column adds an extra task and focuses its name box; D in the tasks column removes it.',
        steps: EXTRA_TASK_STEPS,
      },
      {
        name: 'review and cancel',
        why: 'Esc closes the review; C in the review and closing the session each ask to cancel the primer, and n or Esc keeps it; sending the primer closes its row with no prompt.',
        steps: REVIEW_STEPS,
      },
      {
        name: 'layout preview',
        why: 'Space z l p opens the sample primer in a session of its own with no agent and selects its row; cancelling it closes that session.',
        steps: PREVIEW_STEPS,
      },
    ],
    problems: (result) => {
      const { run, result: toolResult } = result as PrimerSelfTestResult;
      if (toolResult.isError) {
        return [`open_primer failed: ${toolResult.content[0]?.text}`];
      }
      return payloadProblems(
        toolResult.structuredContent as unknown as PrimerPayload,
        run,
      );
    },
  };
}
