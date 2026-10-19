import type { PageBind } from '../../../contracts/keymap';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type {
  ConnectedSession,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { AnswersPayload } from '../contract';
import { formsCommand, formsScope } from '../ids';

// Exists only for the self-test, which adds it to the keymap main serves; it
// is never in the user's keymap. No step completes it: `q a x` then `b` breaks
// it, so `a` runs forms.editNotes and `x b` are typed into the Notes box.
const PAGE_BINDS: PageBind[] = [
  {
    keys: ['q', 'a', 'x', 'y'],
    scope: formsScope('forms'),
    command: formsCommand('nextItem'),
  },
];

// An unbroken run of letters wider than any pane; no j, which would start jk.
const LONG_WORD = 'unbroken'.repeat(14);

// Opening on the finding: Space then k replays k to the notice, j back to the
// finding, pick 2; a
// types "agreed" at once (INSERT), Esc out. j to question 1, pick 2; a types
// "ab" at once, Esc out; d focuses its reason box, A appends a long word and
// Ctrl+k still in INSERT moves back to its notes box, Esc out; a again types
// "c" after "ab". j to question 2, where q a x then b breaks the self-test
// bind, so a opens the notes box and "xb" is typed into it; jk Esc out and x
// marks question 2 not applicable. Ctrl+h goes back to question 1, Space a 2
// clears its choice and picks it again, Space 2 jumps to question 2, and
// Space e n finds no unanswered item. Option+o moves to the second session's
// tab; Cmd+W there asks to cancel its round, Esc keeps it and returns to its
// form, where j moves to its question 2 and Space e p finds its untouched
// question 1; Option+i moves back to the first tab. Then review, ? opens and
// closes help, C opens and n dismisses the cancel prompt, o types "note" into
// the Round note at once (INSERT), Esc out, Enter jumps back to the finding,
// review again and Space Enter submits.
const STEPS: SelfTestStep[] = [
  { keys: [' ', 'k'], expect: '[page] k ran forms.prevItem', checksFit: true },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['2'], expect: '[forms] chose 2 on finding 1' },
  { keys: ['a'], expect: '[forms] focused notes on finding 1' },
  {
    keys: [...'agreed', 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
  },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['a', 'b', 'j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['d'], expect: '[forms] focused dontAskReason on question 1' },
  {
    keys: ['A', ...LONG_WORD, '<C-k>'],
    expect: '[forms] focused notes on question 1',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[forms] left the box' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['c', 'j', 'k', 'Escape'], expect: '[forms] left the box' },
  {
    keys: ['j', 'q', 'a', 'x', 'b'],
    expect: '[page] typed xb into the editor',
  },
  { keys: ['j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['x'], expect: '[forms] not applicable on question 2' },
  { keys: ['<C-h>'], expect: '[page] <C-h> ran forms.prevItem' },
  {
    keys: [' ', 'a', '2'],
    expect: '[forms] cleared the choice on question 1',
  },
  { keys: [' ', 'a', '2'], expect: '[forms] chose 2 on question 1' },
  { keys: [' ', '2'], expect: '[forms] jumped to question 2' },
  { keys: [' ', 'e', 'n'], expect: '[forms] no unanswered item' },
  {
    keys: ['<A-o>'],
    expect: '[sessions] activated selftest 2',
    checksFit: true,
  },
  {
    keys: ['<D-w>'],
    expect:
      '[forms] closing the tab asks to cancel selftest · Second self-test round',
  },
  { keys: ['Escape'], expect: '[page] Escape ran forms.dismissConfirm' },
  { keys: ['j'], expect: '[page] j ran forms.nextItem' },
  { keys: [' ', 'e', 'p'], expect: '[forms] jumped to question 1' },
  { keys: ['<A-i>'], expect: '[sessions] activated selftest' },
  { keys: [' ', ' '], expect: '[forms] review opened', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran forms.toggleHelp', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran forms.closeHelp' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  {
    keys: ['o', 'n', 'o', 't', 'e', 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
    checksFit: true,
  },
  { keys: ['Enter'], expect: '[page] Enter ran forms.reviewJump' },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  { keys: [' ', 'Enter'], expect: '[forms] submitted' },
];

// Code and tables scroll in their own box, and rail and tab titles end in an
// ellipsis, their full text in the item heading and the tooltip.
const SCROLLS_ITSELF = [
  '.md pre',
  '.md table',
  '.rail-title',
  '.session-tab-label',
];

// Each run's fixture differs in one context line, so a later run never opens
// pre-filled from an earlier run's saved draft.
function fixtureRound(run: number) {
  return {
    heading: 'Self-test round',
    overview: 'Drives the forms view offscreen.',
    notices: [
      {
        title: 'A settled point',
        context: `Run ${run}: nothing to decide here.`,
        badge: 'Decided',
      },
    ],
    findings: [
      {
        title: `A finding titled ${LONG_WORD}`,
        finding: `- the code calls ${LONG_WORD}`,
        proof: ['```', `proof ${LONG_WORD}`, '```'].join('\n'),
        choices: [
          { text: 'Fix it', reason: 'It is a small change.' },
          {
            text: `Leave it ${LONG_WORD}`,
            reason: `Because ${LONG_WORD} is used.`,
          },
        ],
        recommend: 1,
      },
    ],
    questions: [
      {
        title: `First question titled ${LONG_WORD}`,
        context: [
          `- a fact naming ${LONG_WORD}`,
          '',
          `| ${Array.from({ length: 12 }, (_, column) => `column ${column}`).join(' | ')} |`,
          `|${' --- |'.repeat(12)}`,
          `|${' cell |'.repeat(12)}`,
          '',
          '```',
          `code ${LONG_WORD}`,
          '```',
        ].join('\n'),
        question: `Pick one of ${LONG_WORD}.`,
        choices: ['One', `Two ${LONG_WORD}`, 'Three'],
        recommend: 1,
        rationale: 'The first is simplest.',
      },
      {
        title: 'Second question',
        context: '- another fact',
        question: 'Pick one.',
        choices: ['Yes', 'No'],
        recommend: 1,
        rationale: 'Yes is the default.',
      },
    ],
  };
}

// The round the second session's tab holds; the run never answers it.
function secondRound(run: number) {
  const waiting = {
    context: `Run ${run}: waits here.`,
    question: 'Pick one.',
    choices: ['Yes', 'No'],
    recommend: 1,
    rationale: 'Yes is the default.',
  };
  return {
    heading: 'Second self-test round',
    overview: 'Waits in the second tab.',
    notices: [],
    questions: [
      { title: 'Waits', ...waiting },
      { title: 'Also waits', ...waiting },
    ],
  };
}

function toolResultProblems(result: ToolResult): string[] {
  if (result.isError) {
    return [`ask_round failed: ${result.content[0].text}`];
  }
  return payloadProblems(result.structuredContent as unknown as AnswersPayload);
}

// What the fixture's answers must come back as after STEPS.
function payloadProblems(payload: AnswersPayload): string[] {
  const [finding] = payload.findings;
  const [first, second] = payload.answers;
  const checks: [boolean, string][] = [
    [payload.outcome === 'submitted', `outcome ${payload.outcome}`],
    [
      payload.summary ===
        '1 finding, 2 questions: 2 answered, 1 not applicable, 0 untouched.',
      `summary ${JSON.stringify(payload.summary)}`,
    ],
    [finding?.status === 'answered', `finding 1 status ${finding?.status}`],
    [finding?.choice === 2, `finding 1 choice ${finding?.choice}`],
    [
      finding?.took_recommendation === false,
      `finding 1 took_recommendation ${finding?.took_recommendation}`,
    ],
    [
      finding?.notes === 'agreed',
      `finding 1 notes ${JSON.stringify(finding?.notes)}`,
    ],
    [first?.status === 'answered', `question 1 status ${first?.status}`],
    [first?.choice === 2, `question 1 choice ${first?.choice}`],
    // "abc" proves each a entered INSERT with the cursor at the end.
    [
      first?.notes === 'abc',
      `question 1 notes ${JSON.stringify(first?.notes)}`,
    ],
    [first?.dont_ask === true, `question 1 dont_ask ${first?.dont_ask}`],
    [
      first?.dont_ask_reason === LONG_WORD,
      `question 1 dont_ask_reason ${JSON.stringify(first?.dont_ask_reason)}`,
    ],
    // "xb" proves the keys a broken sequence left over were typed into the
    // box its command focused, in INSERT.
    [
      second?.notes === 'xb',
      `question 2 notes ${JSON.stringify(second?.notes)}`,
    ],
    [
      second?.status === 'not_applicable',
      `question 2 status ${second?.status}`,
    ],
    // "note" proves o entered INSERT at once, keys typed straight after it.
    [payload.note === 'note', `note ${JSON.stringify(payload.note)}`],
    [payload.notices.length === 1, `${payload.notices.length} notices`],
  ];
  return checks.filter(([passed]) => !passed).map(([, problem]) => problem);
}

// Connects two sessions each run, ending the previous run's, and asks the
// fixture round in the first and a second round in the second, which the
// steps never answer. The first round is shown first, so its tab is active;
// the script checks the answers the first call returns.
export function formsSelfTestScript(
  sessions: Pick<SessionsMainExports, 'connect'>,
): SelfTestScript {
  let connected: ConnectedSession[] = [];
  const connect = (sessionId: string) =>
    sessions.connect({
      sessionId,
      projectDir: 'selftest',
      deadlineSeconds: 120,
    });
  const ask = (session: ConnectedSession, round: unknown) =>
    session.call('ask_round', round, {
      toolUseId: null,
      signal: new AbortController().signal,
    });
  return {
    pageBinds: PAGE_BINDS,
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      for (const session of connected) {
        session.end();
      }
      const first = connect(`selftest-${run}`);
      const second = connect(`selftest-${run}-2`);
      connected = [first, second];
      const result = ask(first, fixtureRound(run));
      // Nothing checks the second call's end: a later run ends its session.
      ask(second, secondRound(run)).catch(() => undefined);
      return {
        shownLine: '[forms] round shown: selftest · Second self-test round',
        result,
      };
    },
    steps: STEPS,
    problems: (result) => toolResultProblems(result as ToolResult),
  };
}
