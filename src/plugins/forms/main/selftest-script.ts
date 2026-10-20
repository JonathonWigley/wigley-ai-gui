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

// A which-key panel left open closes after this long, so steps can wait it
// out; long enough that the fit check under an open panel ends first.
const SETTINGS = { keys: { whichKeyTimeoutMs: 1000 } };

// An unbroken run of letters wider than any pane; no j, which would start jk.
const LONG_WORD = 'unbroken'.repeat(14);

// Opening on finding 1: Space then k replays k to the notice, j back to the
// finding; Space a f sets Fix now, 2 picks solution 2, Space a f again clears
// the action and Space a s sets Leave it. a types "agreed" at once (INSERT), jk
// to NORMAL, where Space a u (the editor bind) sets Follow-up; Esc out. j to
// finding 2, a Nit: Space a u is refused, since a Nit offers no follow-up, and
// Space a f alone answers its one solution with Fix anyway. j to finding 3, a
// Decision: Space a u sets Plan it, and Enter accepts its recommendation. j to
// question 1, where 2 picks 2; a types "ab" at once, Esc out; d focuses its
// reason box, A appends a long word and Ctrl+k still in INSERT moves back to
// its notes box, Esc out; a again types "c" after "ab". a once more, jk to
// NORMAL, where Space opens which-key and Esc closes it without leaving the box
// (vim drops its pending input); Space opens it again and, with no key pressed,
// the which-key timeout closes it, and Esc then leaves the box, so the box kept
// focus and its pending Space was dropped. a back in, jk, Space opens
// which-key, and Ctrl+j moving to the reason box closes it; jk Esc out. a, jk
// and d, then Ctrl+j to the reason box and Ctrl+k back; w and Esc leave the
// box, and w deleted nothing, since leaving dropped the pending d. j to
// question 2, where q a x then b breaks the self-test bind, so a opens the
// notes box and "xb" is typed into it; jk Esc out and x marks question 2 not
// applicable. Ctrl+h goes back to question 1, where Space opens which-key and
// the timeout closes it, so 2 starts a fresh sequence and clears the choice
// (Space 2 would jump), 2 picks it again; Space a 2 clears it and picks it
// again, Enter replaces that pick with its recommendation, Space 2 jumps to
// question 2, and Space e n finds no unanswered item.
// Space opens which-key, a moves it into the Space a group, and Esc cancels the
// sequence and closes it. Option+o moves to the second session's tab; Cmd+W
// there asks to cancel its round, Esc keeps it and returns to its form, where j
// moves to its question 2 and Space e p finds its untouched question 1;
// Option+i moves back to the first tab. Then review, Space ? opens help and Esc
// closes it, back in the review's scope, where C opens and n dismisses the
// cancel prompt; Space ? opens help again, Cmd+W opens the cancel prompt, which
// closes help, so n dismisses the prompt. o types "note" into the Round note at
// once (INSERT), Esc out, Enter jumps back to finding 1, review again and Space
// Enter submits.
const STEPS: SelfTestStep[] = [
  { keys: [' ', 'k'], expect: '[page] k ran forms.prevItem', checksFit: true },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: [' ', 'a', 'f'], expect: '[forms] chose Fix now on finding 1' },
  { keys: ['2'], expect: '[forms] chose 2 on finding 1' },
  { keys: [' ', 'a', 'f'], expect: '[forms] cleared the action on finding 1' },
  { keys: [' ', 'a', 's'], expect: '[forms] chose Leave it on finding 1' },
  { keys: ['a'], expect: '[forms] focused notes on finding 1' },
  {
    keys: [...'agreed', 'j', 'k', ' ', 'a', 'u'],
    expect: '[forms] chose Follow-up on finding 1',
  },
  { keys: ['Escape'], expect: '[forms] left the box' },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: [' ', 'a', 'u'], expect: '[forms] finding 2 offers no follow-up' },
  { keys: [' ', 'a', 'f'], expect: '[forms] chose Fix anyway on finding 2' },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: [' ', 'a', 'u'], expect: '[forms] chose Plan it on finding 3' },
  {
    keys: ['Enter'],
    expect: '[forms] accepted the recommendation on finding 3',
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
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['j', 'k', ' '], expect: '[keys] which-key shows Space' },
  { keys: ['Escape'], expect: '[keys] which-key closed' },
  { keys: [' '], expect: '[keys] which-key shows Space' },
  { keys: [], expect: '[keys] which-key closed' },
  { keys: ['Escape'], expect: '[forms] left the box' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['j', 'k', ' '], expect: '[keys] which-key shows Space' },
  { keys: ['<C-j>'], expect: '[keys] which-key closed' },
  { keys: ['j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  {
    keys: ['j', 'k', 'd', '<C-j>'],
    expect: '[forms] focused dontAskReason on question 1',
  },
  { keys: ['<C-k>'], expect: '[forms] focused notes on question 1' },
  { keys: ['w', 'Escape'], expect: '[forms] left the box' },
  {
    keys: ['j', 'q', 'a', 'x', 'b'],
    expect: '[page] typed xb into the editor',
  },
  { keys: ['j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['x'], expect: '[forms] not applicable on question 2' },
  { keys: ['<C-h>'], expect: '[page] <C-h> ran forms.prevItem' },
  { keys: [' '], expect: '[keys] which-key shows Space' },
  { keys: [], expect: '[keys] which-key closed' },
  { keys: ['2'], expect: '[forms] cleared the choice on question 1' },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  {
    keys: [' ', 'a', '2'],
    expect: '[forms] cleared the choice on question 1',
  },
  { keys: [' ', 'a', '2'], expect: '[forms] chose 2 on question 1' },
  {
    keys: ['Enter'],
    expect: '[forms] accepted the recommendation on question 1',
  },
  { keys: [' ', '2'], expect: '[forms] jumped to question 2' },
  { keys: [' ', 'e', 'n'], expect: '[forms] no unanswered item' },
  { keys: [' '], expect: '[keys] which-key shows Space', checksFit: true },
  { keys: ['a'], expect: '[keys] which-key shows Space a' },
  { keys: ['Escape'], expect: '[keys] which-key closed' },
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
  {
    keys: [' ', '?'],
    expect: '[page]  ? ran keys.toggleHelp',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  { keys: [' ', '?'], expect: '[page]  ? ran keys.toggleHelp' },
  {
    keys: ['<D-w>'],
    expect: '[forms] closing the tab asks to cancel selftest · Self-test round',
  },
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
        origin: 'caused',
        severity: 'important',
        impact: `Callers of ${LONG_WORD} see the wrong result.`,
        finding: `- the code calls ${LONG_WORD}`,
        proof: ['```', `proof ${LONG_WORD}`, '```'].join('\n'),
        choices: [
          { text: 'Fix it', reason: 'It is a small change.' },
          {
            text: `Keep ${LONG_WORD}`,
            reason: `Because ${LONG_WORD} is used.`,
          },
        ],
        recommend: 1,
        recommend_action: 'fix_now',
      },
      {
        title: 'A one-solution finding',
        origin: 'nit',
        impact: 'Every call pays for a second check.',
        finding: '- the code repeats a check',
        proof: '`check()` runs twice.',
        choices: [{ text: 'Drop one', reason: 'One check is enough.' }],
        recommend: 1,
        recommend_action: 'fix_now',
      },
      {
        title: 'A design finding',
        origin: 'design',
        impact: 'Settings either follow the user or the machine.',
        finding: '- settings have no owner',
        proof: '`settings.json` sits beside the app.',
        choices: [
          { text: 'Per user', reason: 'Each user keeps their own.' },
          { text: 'Shared', reason: 'One file is simpler.' },
        ],
        recommend: 2,
        recommend_action: 'follow_up',
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
  const [finding, nit, design] = payload.findings;
  const [first, second] = payload.answers;
  const checks: [boolean, string][] = [
    [payload.outcome === 'submitted', `outcome ${payload.outcome}`],
    [
      payload.summary ===
        '3 findings, 2 questions: 4 answered, 1 not applicable, 0 untouched.',
      `summary ${JSON.stringify(payload.summary)}`,
    ],
    [finding?.status === 'answered', `finding 1 status ${finding?.status}`],
    [finding?.choice === 2, `finding 1 choice ${finding?.choice}`],
    [
      finding?.took_recommendation === false,
      `finding 1 took_recommendation ${finding?.took_recommendation}`,
    ],
    [finding?.action === 'follow_up', `finding 1 action ${finding?.action}`],
    [
      finding?.took_action_recommendation === false,
      `finding 1 took_action_recommendation ${finding?.took_action_recommendation}`,
    ],
    [
      finding?.notes === 'agreed',
      `finding 1 notes ${JSON.stringify(finding?.notes)}`,
    ],
    [nit?.status === 'answered', `finding 2 status ${nit?.status}`],
    [nit?.choice === 1, `finding 2 choice ${nit?.choice}`],
    [nit?.action === 'fix_now', `finding 2 action ${nit?.action}`],
    [
      nit?.took_action_recommendation === true,
      `finding 2 took_action_recommendation ${nit?.took_action_recommendation}`,
    ],
    [design?.status === 'answered', `finding 3 status ${design?.status}`],
    [design?.choice === 2, `finding 3 choice ${design?.choice}`],
    [
      design?.took_recommendation === true,
      `finding 3 took_recommendation ${design?.took_recommendation}`,
    ],
    [design?.action === 'follow_up', `finding 3 action ${design?.action}`],
    [
      design?.took_action_recommendation === true,
      `finding 3 took_action_recommendation ${design?.took_action_recommendation}`,
    ],
    [first?.status === 'answered', `question 1 status ${first?.status}`],
    // Choice 1, the recommendation, proves Enter replaced the pick of 2.
    [first?.choice === 1, `question 1 choice ${first?.choice}`],
    [
      first?.took_recommendation === true,
      `question 1 took_recommendation ${first?.took_recommendation}`,
    ],
    // "abc" proves each a entered INSERT with the cursor at the end, and that
    // a d left pending in the box deleted nothing once the box was left.
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
    settings: SETTINGS,
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
