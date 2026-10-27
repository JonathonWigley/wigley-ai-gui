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

// From the Feature row: task 1 needs no; the rail walks task 1's items into
// task 2, whose need is set to yes from its first item row and whose second
// item is left out from the rail; task 3 is unclear. On task 2's card, ⌃L
// steps to its item cards, the second item is toggled back and forth, and its
// comment and its task's comment boxes are reached; `a` from an item card adds
// `Polish` on the task card, and ⌃H steps to task 1 before focus returns to
// the rail.
const PRIMER_STEPS: SelfTestStep[] = [
  {
    keys: ['j'],
    expect: '[page] j ran primer.nextRow',
    checksFit: true,
    screenshot: 'rail',
  },
  { keys: ['n'], expect: '[page] n ran primer.needNo' },
  { keys: ['j'], expect: '[primer] selected item 1 on task 1' },
  { keys: ['j'], expect: '[primer] selected item 2 on task 1' },
  { keys: ['j'], expect: '[primer] selected task 2' },
  {
    keys: ['j'],
    expect: '[primer] selected item 1 on task 2',
    screenshot: 'rail-item',
  },
  {
    keys: ['y'],
    expect: '[primer] need yes on task 2',
    why: "A need key on an item row sets its task's need.",
  },
  { keys: ['j'], expect: '[primer] selected item 2 on task 2' },
  { keys: ['x'], expect: '[primer] left out item 2 on task 2' },
  { keys: ['j'], expect: '[primer] selected task 3' },
  { keys: ['u'], expect: '[page] u ran primer.needUnclear' },
  { keys: ['k'], expect: '[primer] selected task 2' },
  {
    keys: ['<A-l>'],
    expect: '[page] <A-l> ran primer.focusCard',
    checksFit: true,
    screenshot: 'task-card',
  },
  {
    keys: ['<C-l>'],
    expect: '[primer] selected item 1 on task 2',
    checksFit: true,
    screenshot: 'item-card',
  },
  { keys: ['<C-l>'], expect: '[primer] selected item 2 on task 2' },
  { keys: ['x'], expect: '[primer] included item 2 on task 2' },
  { keys: ['x'], expect: '[primer] left out item 2 on task 2' },
  { keys: ['c'], expect: '[primer] focused comment on item 2 of task 2' },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  {
    keys: ['C'],
    expect: '[primer] focused comment on task 2',
    why: "C on an item card shows its task's card and focuses the task's comment box.",
  },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  { keys: ['<C-l>'], expect: '[primer] selected item 1 on task 2' },
  {
    keys: ['a', 'P', 'o', 'l', 'i', 's', 'h', 'Escape', 'Escape'],
    expect: '[primer] added item 3 on task 2',
    why: "a on an item card shows its task's card and focuses the add-item box; leaving the box adds the item.",
  },
  {
    keys: ['<C-h>'],
    expect: '[primer] selected task 1',
    why: "From task 2's card, ⌃H steps to the row drawn above it, task 1's row.",
  },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran primer.focusRail' },
];

// An extra task added from the rail and removed again, so the submitted
// payload holds only the sent tasks.
const EXTRA_TASK_STEPS: SelfTestStep[] = [
  {
    keys: ['A'],
    expect: '[primer] added extra task extra-1',
    checksFit: true,
  },
  { keys: ['Escape', 'Escape'], expect: '[primer] left the box' },
  { keys: ['<A-h>'], expect: '[page] <A-h> ran primer.focusRail' },
  { keys: ['D'], expect: '[primer] removed extra task extra-1' },
];

// The review opens, closes and opens again; the cancel prompt opens from the
// review's cancel key and from closing the session, and is dismissed each
// time; the review submits, and the session, holding no primer now, closes.
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
  { keys: ['<D-Enter>'], expect: '[primer] submitted' },
  {
    keys: ['<D-w>'],
    expect: '[sessions] activated Layout preview',
    why: "Closing selects the session's left neighbour, the Layout preview session forms' script reopened last.",
  },
];

// The sample primer opens in a session of its own and its row is selected;
// the rail, a task card and the review draw through the default layout; the
// sample is cancelled, which closes its session.
const PREVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'p'],
    expect: '[sessions] activated Primer preview',
    checksFit: true,
    screenshot: 'preview',
  },
  { keys: ['j'], expect: '[page] j ran primer.nextRow' },
  {
    keys: ['<A-l>'],
    expect: '[page] <A-l> ran primer.focusCard',
    checksFit: true,
    screenshot: 'preview-task-card',
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
// the steps start on its Primer tab whatever session the earlier scripts left
// selected, and opens the self-test primer there; the script checks the
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
        why: "The Primer tab expands the selected task's items in the rail, sets needs and toggles items from task and item rows, steps rows on the card with ⌃L and ⌃H, and reaches the task's boxes from an item card; the agent gets every change back once the review submits.",
        steps: PRIMER_STEPS,
      },
      {
        name: 'extra task',
        why: 'A on the rail adds an extra task and focuses its name box; D on the rail removes it.',
        steps: EXTRA_TASK_STEPS,
      },
      {
        name: 'review and cancel',
        why: 'Esc closes the review; C in the review and closing the session each ask to cancel the primer, and n or Esc keeps it; once the primer is sent, its session closes with no prompt.',
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
