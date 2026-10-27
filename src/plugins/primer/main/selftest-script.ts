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

// From the Feature row: entry 1 needs no, entry 2 yes, entry 3 unclear; back
// on entry 2 (Screen), its second item is excluded and `Polish` added; then
// focus returns to the rail.
const PRIMER_STEPS: SelfTestStep[] = [
  {
    keys: ['j'],
    expect: '[page] j ran primer.nextRow',
    checksFit: true,
    screenshot: 'rail',
  },
  { keys: ['n'], expect: '[page] n ran primer.needNo' },
  { keys: ['j'], expect: '[page] j ran primer.nextRow' },
  { keys: ['y'], expect: '[page] y ran primer.needYes' },
  { keys: ['j'], expect: '[page] j ran primer.nextRow' },
  { keys: ['u'], expect: '[page] u ran primer.needUnclear' },
  { keys: ['k'], expect: '[page] k ran primer.prevRow' },
  {
    keys: ['<A-l>'],
    expect: '[page] <A-l> ran primer.focusCard',
    checksFit: true,
    screenshot: 'card',
  },
  { keys: ['j'], expect: '[page] j ran primer.nextItem' },
  { keys: ['x'], expect: '[page] x ran primer.toggleInclude' },
  {
    keys: ['a', 'P', 'o', 'l', 'i', 's', 'h', 'Escape', 'Escape'],
    expect: '[primer] left the box',
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
        why: 'The Primer tab sets needs from the rail and toggles and adds items on the card; the agent gets every change back once the review submits.',
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
