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
// the review opens and submits.
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
  {
    keys: [' ', ' '],
    expect: '[primer] review opened',
    checksFit: true,
    screenshot: 'review',
  },
  { keys: ['<D-Enter>'], expect: '[primer] submitted' },
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
        why: 'The Primer tab sets needs from the rail, toggles and adds items on the card, and submits from the review; the agent gets every change back.',
        steps: PRIMER_STEPS,
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
