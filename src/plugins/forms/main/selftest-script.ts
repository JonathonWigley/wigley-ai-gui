import type { PageBind } from '../../../contracts/keymap';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type {
  ConnectedSession,
  Harness,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { AnswersPayload } from '../contract';
import { formsCommand, formsScope } from '../ids';
import { askFixtureRound, connectFixtureSession } from './fixtures';

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

// The user keymap file, under the self-test's temp home.
const USER_KEYMAP_FILE = '.config/wigley-ai-gui/keymap.json';

// A user keymap binding `Q`, which nothing else binds, to `command` everywhere.
function userKeymap(command: string): string {
  return JSON.stringify({
    binds: [{ keys: 'Q', scope: 'any', command }],
  });
}

// A user keymap moving the text box's not-applicable toggle in the form from
// <Leader>x to <Leader>q, which nothing else binds.
const MOVED_NOT_APPLICABLE_KEYMAP = JSON.stringify({
  binds: [
    {
      keys: '<Leader>q',
      scope: 'forms.forms',
      command: 'forms.toggleNotApplicable',
      where: 'box',
    },
  ],
  unbind: [{ keys: '<Leader>x', scope: 'forms.forms', where: 'box' }],
});

// A user keymap making `,` the leader, on the page and in a text box.
const COMMA_LEADER_KEYMAP = JSON.stringify({ leader: ',' });

// An unbroken run of letters wider than any pane.
const LONG_WORD = 'unbroken'.repeat(14);

// The layout forms' main writes into its data folder in the self-test only,
// so the layout cycle holds `default` and `selftest`. Its question card builds
// through the kit and throws on every update, its finding card mounts its
// notes box and then throws, so the default card can mount that box only once
// the host has destroyed it, and its notice card mounts a notes box, which a
// notice lacks.
export const SELFTEST_LAYOUT = {
  path: 'layouts/selftest/layout.js',
  text: `export default {
  cards: {
    question(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item question');
      kit.itemHead(article, 'Question');
      kit.section(article, 'Question', input.question);
      kit.section(article, 'Context', input.context);
      kit.answerControls(kit.choiceList(article, 'recommended'));
      return {
        element: article,
        update() {
          throw new Error('selftest update throw');
        },
      };
    },
    finding(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item finding');
      kit.textBox(article, 'notes');
      throw new Error('selftest throw');
    },
    notice(parent, input, kit) {
      const article = kit.el(parent, 'article', 'item notice');
      kit.textBox(article, 'notes');
      return { element: article };
    },
  },
};
`,
};

// The gallery steps run first, before any step raises a toast, so no toast
// covers their screenshots.
const GALLERY_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'o'],
    expect: '[sessions] activated Layout preview',
    why: "Opens the layout preview's sample round, every card kind, in a session of its own after the other three, and selects its row.",
  },
  {
    keys: [' ', 'z', 'g'],
    expect: '[page] showed Gallery mode',
    checksFit: true,
    screenshot: 'gallery-full-0',
  },
  {
    keys: ['<C-j>'],
    expect: '[gallery] paged down',
    repeat: { until: '[gallery] reached the end', max: 12 },
    screenshot: 'gallery-full',
  },
  { keys: ['G'], expect: '[gallery] scrolled to the end' },
  {
    keys: ['t'],
    expect: '[gallery] transparency reduced',
  },
  {
    keys: ['g', 'g'],
    expect: '[gallery] scrolled to the top',
    screenshot: 'gallery-reduced-0',
  },
  {
    keys: ['<C-j>'],
    expect: '[gallery] paged down',
    repeat: { until: '[gallery] reached the end', max: 12 },
    screenshot: 'gallery-reduced',
  },
  { keys: ['<C-k>'], expect: '[gallery] paged up' },
  { keys: ['g', 'g'], expect: '[gallery] scrolled to the top' },
  { keys: ['<C-k>'], expect: '[gallery] reached the top' },
  {
    keys: [' ', 'k', 's'],
    expect: '[page] showed Sessions mode',
    screenshot: 'sessions-reduced',
  },
  { keys: [' ', 'z', 'g'], expect: '[page] showed Gallery mode' },
  { keys: ['t'], expect: '[gallery] transparency full' },
  {
    keys: [' ', 'k', 's'],
    expect: '[page] showed Sessions mode',
    screenshot: 'sessions-full',
  },
  {
    keys: [' ', 'z', 's'],
    expect: '[gallery] shell layout swapped',
    screenshot: 'shell-layout-test',
  },
  {
    keys: [' ', 'z', 's'],
    expect: '[gallery] shell layout restored',
    screenshot: 'shell-layout-restored',
  },
  { keys: ['<A-S-o>'], expect: '[sessions] activated selftest' },
];

const FINDING_ACTIONS_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'k', 'k'],
    expect: '[page] k ran forms.prevItem',
    checksFit: true,
    why: 'Space k then k breaks Space k s, so the first k replays to the notice and the second finds no item before it.',
  },
  {
    keys: ['j'],
    expect: '[page] j ran forms.nextItem',
    checksFit: true,
    screenshot: 'round',
  },
  { keys: ['2'], expect: '[forms] chose 2 on finding 1' },
  { keys: ['f'], expect: '[forms] cleared the action on finding 1' },
  { keys: ['s'], expect: '[forms] chose Leave it on finding 1' },
  {
    keys: ['a'],
    expect: '[forms] focused notes on finding 1',
    why: 'a enters the notes box in INSERT, so the next step types at once.',
  },
  {
    keys: [...'agreed', 'Escape', ' ', 'a', 'u'],
    expect: '[forms] chose Follow-up on finding 1',
    why: 'Space a u in NORMAL inside the box is the editor bind.',
  },
  {
    keys: ['Escape'],
    expect: '[forms] left the box',
    why: "Every Esc out of a box in NORMAL runs forms' editor bind there.",
  },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['u'], expect: '[forms] finding 2 offers no follow-up' },
  {
    keys: ['s'],
    expect: '[forms] chose Leave it on finding 2',
    why: 'A Nit opens on Fix anyway with its one solution.',
  },
  { keys: ['f'], expect: '[forms] chose Fix anyway on finding 2' },
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['u'], expect: '[forms] chose Plan it on finding 3' },
  {
    keys: ['Enter'],
    expect: '[forms] accepted the recommendation on finding 3',
  },
];

const QUESTION_BOXES_STEPS: SelfTestStep[] = [
  { keys: ['j'], expect: '[page] j ran forms.nextItem', checksFit: true },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  {
    keys: ['a', 'b', 'Escape', 'Escape'],
    expect: '[forms] left the box',
    why: 'The first Esc goes to NORMAL, the second leaves the box.',
  },
  { keys: ['d'], expect: '[forms] focused dontAskReason on question 1' },
  {
    keys: ['A', ...LONG_WORD, '<C-p>'],
    expect: '[forms] focused notes on question 1',
    checksFit: true,
    why: 'Ctrl+p, still in INSERT, moves back from the reason box to the notes box.',
  },
  { keys: ['Escape'], expect: '[forms] left the box' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  {
    keys: ['c', 'Escape', 'Escape'],
    expect: '[forms] left the box',
    why: 'a enters INSERT with the cursor at the end, so c follows ab.',
  },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['Escape', ' '], expect: '[keys] which-key shows Space' },
  {
    keys: ['Escape'],
    expect: '[keys] which-key closed',
    why: 'Esc closes which-key without leaving the box, vim dropping its pending input.',
  },
  { keys: [' '], expect: '[keys] which-key shows Space' },
  {
    keys: [],
    expect: '[keys] which-key closed',
    why: 'With no key pressed, the which-key timeout closes it.',
  },
  {
    keys: ['Escape'],
    expect: '[forms] left the box',
    why: 'Esc leaving the box shows the box kept focus and its pending Space was dropped.',
  },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  { keys: ['Escape', ' '], expect: '[keys] which-key shows Space' },
  {
    keys: ['<C-n>'],
    expect: '[keys] which-key closed',
    why: 'Ctrl+n moves to the reason box, which it focuses in INSERT, and that closes which-key.',
  },
  { keys: ['Escape', 'Escape'], expect: '[forms] left the box' },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  {
    keys: ['Escape', 'd', '<C-n>'],
    expect: '[forms] focused dontAskReason on question 1',
    why: 'Ctrl+n moves from the notes box to the reason box.',
  },
  {
    keys: ['<C-p>'],
    expect: '[forms] focused notes on question 1',
    why: 'Ctrl+p moves back to the notes box.',
  },
  {
    keys: ['w', 'Escape'],
    expect: '[forms] left the box',
    why: 'w deletes nothing, since leaving the box dropped the pending d.',
  },
  {
    keys: ['<C-j>'],
    expect: '[forms] scrolled the form down half a page',
    repeat: {
      until: '[forms] scrolled the form down half a page to the bottom',
      max: 8,
    },
    why: "Ctrl+j scrolls the form's main column down until it reaches the bottom, since question 1's card overflows the column.",
  },
  { keys: ['a'], expect: '[forms] focused notes on question 1' },
  {
    keys: ['<C-k>'],
    expect: '[forms] scrolled the form up half a page',
    repeat: {
      until: '[forms] scrolled the form up half a page to the top',
      max: 8,
    },
    why: "Ctrl+k scrolls the form up to the top from inside a box, in INSERT; focusing the notes box from the bottom leaves the column off the top, since the box sits far below the card's top.",
  },
  {
    keys: ['<C-j>'],
    expect: '[forms] scrolled the form down half a page',
    repeat: {
      until: '[forms] scrolled the form down half a page to the bottom',
      max: 8,
    },
    why: 'Ctrl+j scrolls the form down to the bottom from inside the box, the column starting at the top.',
  },
  {
    keys: ['Escape', 'Escape'],
    expect: '[forms] left the box',
    why: 'Esc leaving the box shows the box kept focus through the scrolls.',
  },
  {
    keys: ['<C-k>'],
    expect: '[forms] scrolled the form up half a page',
    repeat: {
      until: '[forms] scrolled the form up half a page to the top',
      max: 8,
    },
    why: "Ctrl+k scrolls the form's main column up until it reaches the top.",
  },
];

const BROKEN_BIND_STEPS: SelfTestStep[] = [
  {
    keys: ['j', 'q', 'a', 'x', 'b'],
    expect: '[page] typed xb into the editor',
    why: 'b breaks the self-test bind q a x y, so a opens the notes box and x b are typed into it.',
  },
  { keys: ['Escape', 'Escape'], expect: '[forms] left the box' },
  { keys: ['x'], expect: '[forms] not applicable on question 2' },
];

const USER_KEYMAP_STEPS: SelfTestStep[] = [
  {
    writeFile: { path: USER_KEYMAP_FILE, text: userKeymap('keys.toggleHelp') },
    keys: [],
    expect: '[config] applied a new config',
  },
  { keys: ['Q'], expect: '[page] Q ran keys.toggleHelp' },
  { keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' },
  {
    writeFile: {
      path: USER_KEYMAP_FILE,
      text: userKeymap('keys.noSuchCommand'),
    },
    keys: [],
    expect:
      '[config] keymap.json: "binds[0].command" names no command "keys.noSuchCommand".',
  },
  {
    keys: ['Q'],
    expect: '[page] Q ran keys.toggleHelp',
    why: 'The broken keymap.json kept the last good keys.',
  },
  { keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' },
  {
    writeFile: { path: USER_KEYMAP_FILE, text: '{}' },
    keys: [],
    expect: '[config] applied a new config',
  },
  {
    writeFile: { path: USER_KEYMAP_FILE, text: MOVED_NOT_APPLICABLE_KEYMAP },
    keys: [],
    expect: '[config] applied a new config',
  },
  { keys: ['a'], expect: '[forms] focused notes on question 2' },
  {
    keys: ['Escape', ' ', 'x'],
    expect: '[page] <Leader>x has no bind in forms.forms',
  },
  { keys: [' ', 'q'], expect: '[forms] applicable again on question 2' },
  {
    writeFile: { path: USER_KEYMAP_FILE, text: COMMA_LEADER_KEYMAP },
    keys: [],
    expect: '[config] applied a new config',
  },
  { keys: [',', 'x'], expect: '[forms] not applicable on question 2' },
  {
    writeFile: { path: USER_KEYMAP_FILE, text: '{}' },
    keys: [],
    expect: '[config] applied a new config',
  },
  {
    keys: [' ', 'x'],
    expect: '[forms] applicable again on question 2',
    why: '{} restores the Space leader and <Leader>x, though Space was unmapped as the leader once already.',
  },
  { keys: [' ', 'x'], expect: '[forms] not applicable on question 2' },
  { keys: ['Escape'], expect: '[forms] left the box' },
];

const CHOICES_STEPS: SelfTestStep[] = [
  { keys: ['<C-h>'], expect: '[page] <C-h> ran forms.prevItem' },
  { keys: [' '], expect: '[keys] which-key shows Space' },
  { keys: [], expect: '[keys] which-key closed' },
  {
    keys: ['2'],
    expect: '[forms] cleared the choice on question 1',
    why: 'The which-key timeout ended the Space sequence, so 2 starts a fresh one.',
  },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  { keys: ['c'], expect: '[forms] cleared the choice on question 1' },
  { keys: ['2'], expect: '[forms] chose 2 on question 1' },
  {
    keys: ['Enter'],
    expect: '[forms] accepted the recommendation on question 1',
  },
  { keys: ['j'], expect: '[page] j ran forms.nextItem' },
  { keys: ['<A-n>'], expect: '[forms] no unanswered item' },
  { keys: [' '], expect: '[keys] which-key shows Space', checksFit: true },
  { keys: ['z'], expect: '[keys] which-key shows Space z' },
  { keys: ['Escape'], expect: '[keys] which-key closed' },
];

const SECOND_SESSION_STEPS: SelfTestStep[] = [
  {
    keys: ['<A-S-o>'],
    expect: '[sessions] activated selftest 2',
    checksFit: true,
  },
  {
    keys: ['<A-o>'],
    expect: '[sessions] showed Docs tab in selftest 2',
    checksFit: true,
  },
  { keys: ['<A-o>'], expect: '[sessions] showed Form tab in selftest 2' },
  {
    keys: ['<D-w>'],
    expect:
      '[forms] closing the session asks to cancel selftest · Second self-test round',
  },
  { keys: ['Escape'], expect: '[page] Escape ran forms.dismissConfirm' },
  { keys: ['j'], expect: '[page] j ran forms.nextItem' },
  { keys: ['<A-p>'], expect: '[forms] jumped to question 1' },
  { keys: ['<A-S-i>'], expect: '[sessions] activated selftest' },
];

const SIDE_BAR_FROM_A_BOX_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'k', 's'],
    expect: '[page] side bar hidden',
    checksFit: true,
  },
  { keys: [' ', 'k', 's'], expect: '[page] side bar shown' },
  { keys: ['a'], expect: '[forms] focused notes on question 2' },
  { keys: ['<A-n>'], expect: '[forms] no unanswered item' },
  {
    keys: ['Escape', ' ', 'k', 's'],
    expect: '[page] side bar hidden',
    why: 'Space k s in NORMAL inside the box is the editor bind.',
  },
  { keys: [' ', 'k', 's'], expect: '[page] side bar shown' },
  {
    keys: ['Escape'],
    expect: '[forms] left the box',
    why: "Esc in NORMAL runs forms' editor bind.",
  },
];

const CANCELLED_PREVIEW_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[sessions] activated Layout preview' },
  {
    keys: ['<D-w>'],
    expect:
      '[forms] closing the session asks to cancel Layout preview · Layout preview',
  },
  {
    keys: ['y'],
    expect: '[docs] session index: No project folder is known for this session',
    checksFit: true,
    why: "Cancelling closes the session and selects its left neighbour, a Codex session with no folder, whose only tab is its Docs tab; that tab's first show runs the session source, which knows no folder.",
  },
  { keys: ['<A-o>'], expect: '[sessions] no other tab in Codex session' },
  { keys: ['<A-S-o>'], expect: '[sessions] activated selftest' },
];

const LAYOUT_CYCLE_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'n'],
    expect: '[forms] layout selftest finding card failed: selftest throw',
  },
  {
    keys: [' ', 'z', 'l', 'p'],
    expect: '[forms] layout default shown (cycled, revision 3)',
  },
  {
    keys: [' ', 'z', 'l', 'p'],
    expect:
      '[forms] layout selftest notice card failed: notice card has no notes box',
  },
  {
    keys: [' ', 'z', 'l', 'n'],
    expect: '[forms] layout default shown (cycled, revision 5)',
  },
  {
    keys: [' ', 'z', 'l', 'p'],
    expect: '[forms] layout selftest shown (cycled, revision 6)',
  },
  {
    keys: ['k', '2'],
    expect:
      '[forms] layout selftest question card update failed: selftest update throw',
    why: "The shown question 2 card's update threw on load; k shows question 1's card, whose first update throws on the pick.",
  },
  {
    keys: ['Enter'],
    expect: '[forms] accepted the recommendation on question 1',
  },
  { keys: ['j'], expect: '[page] j ran forms.nextItem' },
  {
    keys: [' ', 'z', 'l', 'n'],
    expect: '[forms] layout default shown (cycled, revision 7)',
  },
];

const REVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', ' '],
    expect: '[forms] review opened',
    checksFit: true,
    why: "Review opens only in forms' scope, so it proves the form took its scope back.",
  },
  {
    keys: ['<C-k>'],
    expect: '[forms] the form did not scroll up',
    why: "Ctrl+k reaches the review's round: the layout cycle's last reload scrolled the main column to the top, and opening the review puts its cursor on the first row, finding 1's, which sits in view there, so the column stays at the top.",
  },
  {
    keys: [' ', '?'],
    expect: '[page]  ? ran keys.toggleHelp',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel', checksFit: true },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel' },
  {
    keys: [' ', 'k', 'd'],
    expect: '[forms] cancel prompt dismissed: the view moved on',
  },
  { keys: [' ', 'k', 's'], expect: '[page] showed Sessions mode' },
  { keys: ['C'], expect: '[page] C ran forms.askCancel' },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  { keys: [' ', '?'], expect: '[page]  ? ran keys.toggleHelp' },
  {
    keys: ['<D-w>'],
    expect:
      '[forms] closing the session asks to cancel selftest · Self-test round',
    why: 'The cancel prompt closes help.',
  },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
  {
    keys: ['o', 'n', 'o', 't', 'e', 'Escape', 'Escape'],
    expect: '[forms] left the box',
    checksFit: true,
    why: "o enters the Round note in INSERT at once; the second Esc runs forms' editor bind in the review's scope.",
  },
  { keys: ['Enter'], expect: '[page] Enter ran forms.reviewJump' },
  { keys: [' ', ' '], expect: '[forms] review opened' },
  { keys: ['o', '<D-Enter>'], expect: '[forms] submitted' },
];

const SAMPLE_ROUND_AGAIN_STEPS: SelfTestStep[] = [
  { keys: [' ', 'z', 'l', 'o'], expect: '[sessions] activated Layout preview' },
  {
    keys: ['<D-w>'],
    expect:
      '[forms] closing the session asks to cancel Layout preview · Layout preview',
  },
  { keys: ['n'], expect: '[page] n ran forms.dismissConfirm' },
];

// Code and tables scroll in their own box; a Docs tab's paths and status line
// and a session row's status end in an ellipsis, their full text in the
// tooltip.
const SCROLLS_ITSELF = [
  '.md pre',
  '.md table',
  '.docs-path',
  '.docs-status',
  '.session-row-status',
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

// The round the second session holds; the run never answers it.
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
    overview: 'Waits in the second session.',
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

// What the fixture's answers must come back as after the steps.
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

// Connects three sessions each run, ending the previous run's: a Claude and
// a Codex session in project `selftest`, and a Codex session with no project
// that never gets a round. Asks the fixture round in the first and a second
// round in the second, which the steps never answer. The first round is
// marked first, so its row is selected; the script checks the answers the
// first call returns.
export function formsSelfTestScript(
  sessions: Pick<SessionsMainExports, 'connect'>,
): SelfTestScript {
  let connected: ConnectedSession[] = [];
  const connect = (
    sessionId: string,
    projectDir: string | null,
    harness: Harness,
  ) =>
    connectFixtureSession(sessions, {
      sessionId,
      projectDir,
      harness,
      deadlineSeconds: 120,
    });
  return {
    pageBinds: PAGE_BINDS,
    settings: SETTINGS,
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      for (const session of connected) {
        session.end();
      }
      const first = connect(`selftest-${run}`, 'selftest', 'claude');
      const second = connect(`selftest-${run}-2`, 'selftest', 'codex');
      const idle = connect(`selftest-${run}-3`, null, 'codex');
      connected = [first, second, idle];
      const result = askFixtureRound(first, fixtureRound(run));
      // Nothing checks the second call's end: a later run ends its session.
      askFixtureRound(second, secondRound(run)).catch(() => undefined);
      return {
        shownLine: '[forms] round shown: selftest · Second self-test round',
        result,
      };
    },
    groups: [
      {
        name: 'gallery',
        why: "The layout preview's sample round shows every card kind in Gallery mode, paged to the end and back under full and reduced transparency, and in Sessions mode under both; the shell swaps to the gallery's test layout and back.",
        steps: GALLERY_STEPS,
      },
      {
        name: 'finding actions',
        why: "Findings 1 to 3 take solution picks and actions by key, refusing an action a finding does not offer, and finding 1's notes box sets an action through its editor bind.",
        steps: FINDING_ACTIONS_STEPS,
      },
      {
        name: 'question boxes',
        why: "Question 1's notes and reason boxes enter INSERT at the end and hand focus between them, and which-key inside a box closes without leaving it; pending keys are dropped when the box is left. Ctrl+j and Ctrl+k scroll the form's main column to its bottom and top, from the page and from inside a box.",
        steps: QUESTION_BOXES_STEPS,
      },
      {
        name: 'broken bind',
        why: 'The keys a broken page bind leaves over are typed into the box its command focused, and x marks question 2 not applicable.',
        steps: BROKEN_BIND_STEPS,
      },
      {
        name: 'user keymap',
        why: "The user's keymap.json applies live and a broken one keeps the last good keys; it can move a box bind and change the leader, and {} restores both.",
        steps: USER_KEYMAP_STEPS,
      },
      {
        name: 'choices',
        why: "Question 1's choice clears and re-picks by key and Enter replaces the pick with the recommendation; Option+n finds no unanswered item, and which-key enters and cancels the Space z group.",
        steps: CHOICES_STEPS,
      },
      {
        name: 'second session',
        why: 'The second session cycles its Form and Docs tabs, keeps its round when its cancel prompt is dismissed, and Option+p finds its untouched question.',
        steps: SECOND_SESSION_STEPS,
      },
      {
        name: 'side bar from a box',
        why: 'Space k s hides and shows the side bar from the page and from inside a notes box in NORMAL, and Option+n works in INSERT.',
        steps: SIDE_BAR_FROM_A_BOX_STEPS,
      },
      {
        name: 'cancelled preview',
        why: "Cancelling the preview round closes its session and selects a Codex session with no folder, where no form keeps its scope; wrapping back gives the first session's form its scope again.",
        steps: CANCELLED_PREVIEW_STEPS,
      },
      {
        name: 'layout cycle',
        why: "Cycling layouts logs each selftest card's failure, a throwing build, a missing notes box and a throwing update, without breaking the form, and the cycle returns to default for the steps after. Each load logs every line its cards log at once, so each step checks one of them.",
        steps: LAYOUT_CYCLE_STEPS,
      },
      {
        name: 'review',
        why: "The review opens in forms' scope, where help and the cancel prompt open and close without leaving it, the Round note takes text, Enter jumps back to an item, and Cmd+Enter sends the round.",
        steps: REVIEW_STEPS,
      },
      {
        name: 'sample round again',
        why: 'Reopening the sample round selects its new preview session, which then shows the cancel prompt that n dismisses.',
        steps: SAMPLE_ROUND_AGAIN_STEPS,
      },
    ],
    problems: (result) => toolResultProblems(result as ToolResult),
  };
}
