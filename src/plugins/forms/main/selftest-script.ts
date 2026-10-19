import type { PageBind } from '../../../contracts/keymap';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type { AnswersPayload, FormsService, FormsSession } from '../contract';

// Exists only for the self-test, which adds it to the keymap main serves; it
// is never in the user's keymap. No step completes it: `q a x` then `b` breaks
// it, so `a` runs forms.editWhat and `x b` are typed into the What box.
const PAGE_BINDS: PageBind[] = [
  {
    keys: ['q', 'a', 'x', 'y'],
    scope: 'forms.forms',
    command: 'forms.nextItem',
  },
];

// An unbroken run of letters wider than any pane; no j, which would start jk.
const LONG_WORD = 'unbroken'.repeat(14);

// Starting on the notice: Space then j replays j to question 1, pick 2; a
// types "ab" at once (INSERT), jk then Space j to its why box, A appends a
// long word, Esc out; a again types "c" after "ab"; j to question 2, where
// q a x then b breaks the self-test bind, so a opens the what box and "xb" is
// typed into it; jk Esc out and x marks question 2 not applicable; o types
// "note" into the note box at once (INSERT), Esc out; g t switches rounds;
// review, ? opens and closes help, C opens and n dismisses the cancel prompt, Enter jumps back to the question,
// review again and Space Enter submits.
const STEPS: SelfTestStep[] = [
  { keys: [' ', 'j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['a'], expect: '[forms] focused what on question 1' },
  {
    keys: ['a', 'b', 'j', 'k', ' ', 'j'],
    expect: '[forms] focused why on question 1',
    checksFit: true,
  },
  {
    keys: ['A', ...LONG_WORD, 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
    checksFit: true,
  },
  { keys: ['a'], expect: '[forms] focused what on question 1' },
  { keys: ['c', 'j', 'k', 'Escape'], expect: '[forms] left the box' },
  {
    keys: ['j', 'q', 'a', 'x', 'b'],
    expect: '[page] typed xb into the editor',
  },
  { keys: ['j', 'k', 'Escape'], expect: '[forms] left the box' },
  { keys: ['x'], expect: '[forms] not applicable on question 2' },
  {
    keys: ['o', 'n', 'o', 't', 'e', 'j', 'k', 'Escape'],
    expect: '[forms] left the box',
  },
  { keys: ['g', 't'], expect: '[page] gt ran forms.nextRound' },
  { keys: [' ', ' '], expect: '[forms] review opened', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran forms.toggleHelp', checksFit: true },
  { keys: ['?'], expect: '[page] ? ran forms.closeHelp' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  { keys: ['Enter'], expect: '[page] Enter ran forms.reviewJump' },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  { keys: [' ', 'Enter'], expect: '[forms] submitted' },
];

// Code and tables scroll in their own box, and rail and switcher titles end
// in an ellipsis, their full text in the item heading and the tooltip.
const SCROLLS_ITSELF = [
  '.md pre',
  '.md table',
  '.rail-title',
  '.switcher-label',
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

// What the fixture's answers must come back as after STEPS.
function payloadProblems(payload: AnswersPayload): string[] {
  const [first, second] = payload.answers;
  const checks: [boolean, string][] = [
    [payload.outcome === 'submitted', `outcome ${payload.outcome}`],
    [first?.status === 'answered', `question 1 status ${first?.status}`],
    [first?.choice === 2, `question 1 choice ${first?.choice}`],
    // "abc" proves each a entered INSERT with the cursor at the end.
    [first?.what === 'abc', `question 1 what ${JSON.stringify(first?.what)}`],
    // "xb" proves the keys a broken sequence left over were typed into the
    // box its command focused, in INSERT.
    [second?.what === 'xb', `question 2 what ${JSON.stringify(second?.what)}`],
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

// Opens the fixture round through `forms` in a fresh session each run, ending
// the previous run's session, and checks the answers the round returns.
export function formsSelfTestScript(forms: FormsService): SelfTestScript {
  let session: FormsSession | null = null;
  return {
    pageBinds: PAGE_BINDS,
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      session?.end();
      session = forms.startSession({
        sessionId: `selftest-${run}`,
        projectDir: 'selftest',
        deadlineSeconds: 120,
      });
      return {
        shownLine: '[forms] round shown: selftest · Self-test round',
        result: session.askRound(
          fixtureRound(run),
          null,
          new AbortController().signal,
        ),
      };
    },
    steps: STEPS,
    problems: (result) => payloadProblems(result as AnswersPayload),
  };
}
