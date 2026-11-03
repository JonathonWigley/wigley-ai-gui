import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import {
  DRIVE_SESSION_DEFAULTS,
  type OwnedSession,
  type SessionsMainExports,
  type SessionsState,
} from '../contract';

// The project dirs of the three fixture sessions, in row order; each row's
// label is its dir's name.
const PROJECT_DIRS = ['panes-a', 'panes-b', 'panes-c'] as const;

// A content width wide enough that a pane in a two-column split still splits
// side by side.
const WIDE_WIDTH = 1800;

// `Alt+;` splits panes-a's pane, and the picker's first row, panes-b, loads
// into the new pane on the right.
const SPLIT_AND_PICK_STEPS: SelfTestStep[] = [
  { keys: ['<A-;>'], expect: '[sessions] pane split right' },
  {
    keys: ['Enter'],
    expect: '[sessions] pane loaded panes-b',
    screenshot: 'panes-side-by-side',
  },
];

// `Alt+h` leaves panes-b's pane for panes-a's, and `Ctrl+Alt+l` swaps
// panes-a to the right.
const FOCUS_AND_SWAP_STEPS: SelfTestStep[] = [
  { keys: ['<A-h>'], expect: '[sessions] pane focused panes-a' },
  { keys: ['<C-A-l>'], expect: '[sessions] panes swapped' },
];

// `Alt+'` splits panes-a's pane with panes-c below it, `Alt+Shift+j` moves the
// divider between them, and `Alt+k` focuses panes-a again, whose pane then
// draws its lower focus edge.
const STACKED_RESIZE_STEPS: SelfTestStep[] = [
  { keys: ["<A-'>"], expect: '[sessions] pane split down' },
  { keys: ['Enter'], expect: '[sessions] pane loaded panes-c' },
  {
    keys: ['<A-S-j>'],
    expect: '[page] <A-S-j> ran panes.resizePaneDown',
    screenshot: 'panes-stacked',
  },
  {
    keys: ['<A-k>'],
    expect: '[sessions] pane focused panes-a',
    why: "The pane above a stacked split draws the down edge's focus and swap keys.",
  },
];

// The title the first rename types, and so the text the second one empties.
const RENAMED = 'Renamed in test';

// `Space r r` renames panes-a, focused since the stacked resize, and a second
// `Space r r` with the box emptied hands its naming back to the agent.
const RENAME_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'r', 'r', ...RENAMED, 'Enter'],
    expect: `[sessions] renamed panes-a to "${RENAMED}"`,
  },
  {
    keys: [
      ' ',
      'r',
      'r',
      ...Array<string>(RENAMED.length).fill('Backspace'),
      'Enter',
    ],
    expect: '[sessions] cleared the user title of panes-a',
  },
];

// `Alt+;` splits panes-a's pane and Esc closes the new pane again; `Alt+w`
// then closes panes-a's pane, its session staying a row.
const CANCEL_AND_CLOSE_STEPS: SelfTestStep[] = [
  {
    keys: ['<A-;>'],
    expect: '[sessions] pane split right',
    width: WIDE_WIDTH,
  },
  { keys: ['Escape'], expect: '[sessions] split cancelled' },
  { keys: ['<A-w>'], expect: '[sessions] pane closed' },
];

// Each run ends the sessions the run before opened and opens three in project
// dirs `panes-a`, `panes-b` and `panes-c`, unselected, in that row order, then
// activates panes-a's row. The result check reads main's state: every pane
// key left all three sessions in place. It then ends them, so the scripts
// after this one start with no pane but the last.
export function sessionsSelfTestScript(
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>,
  state: () => SessionsState,
): SelfTestScript {
  let opened: OwnedSession[] = [];
  const endOpened = () => {
    for (const session of opened) {
      session.end();
    }
    opened = [];
  };
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open(run) {
      endOpened();
      opened = PROJECT_DIRS.map((projectDir) =>
        sessions.open(
          {
            sessionId: `${projectDir}-${run}`,
            projectDir,
            harness: DRIVE_SESSION_DEFAULTS.harness,
            deadlineSeconds: DRIVE_SESSION_DEFAULTS.deadlineSeconds,
          },
          { select: false },
        ),
      );
      sessions.activate(opened[0].session.id);
      return {
        shownLine: '[sessions] activated panes-a',
        result: Promise.resolve(null),
      };
    },
    groups: [
      {
        name: 'split and pick',
        why: 'A split opens the picker and loads the chosen session.',
        steps: SPLIT_AND_PICK_STEPS,
      },
      {
        name: 'focus and swap',
        why: 'Smart-splits focus reaches chat panes and swap moves the session.',
        steps: FOCUS_AND_SWAP_STEPS,
      },
      {
        name: 'stacked resize',
        why: 'Vertical dividers resize.',
        steps: STACKED_RESIZE_STEPS,
      },
      {
        name: 'rename',
        why: '<Leader>rr renames the focused session and an empty name hands naming back.',
        steps: RENAME_STEPS,
      },
      {
        name: 'cancel and close',
        why: 'Esc undoes a split and Alt+w closes only the pane.',
        steps: CANCEL_AND_CLOSE_STEPS,
      },
    ],
    problems: () => {
      const rowIds = new Set(state().rows.map((row) => row.sessionId));
      const problems = opened
        .filter((session) => !rowIds.has(session.session.id))
        .map((session) => `session ${session.session.id} left main's rows`);
      endOpened();
      return problems;
    },
  };
}
