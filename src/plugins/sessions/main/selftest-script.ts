import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import {
  DRIVE_SESSION_DEFAULTS,
  type OwnedSession,
  type SessionsMainExports,
  type SessionsState,
} from '../contract';

// The project dirs of the three fixture sessions, in main's row order; each
// row's label is its dir's name.
const PROJECT_DIRS = ['panes-a', 'panes-b', 'panes-c'] as const;

// A content width wide enough that a pane in a two-column split still splits
// side by side.
const WIDE_WIDTH = 1800;

// `Alt+Shift+o` to `label`'s row, however the rows draw, with one pane showing
// them. A press logs its command's line and the activation's in one task.
function stepNextTo(label: string): SelfTestStep {
  return {
    keys: ['<A-S-o>'],
    expect: '[page] <A-S-o> ran sessions.nextSession',
    repeat: {
      until: `[sessions] activated ${label}`,
      max: PROJECT_DIRS.length - 1,
    },
  };
}

// The fixture's rows arrive in separate states and can tie on their millisecond
// stamps, so Recent's order among them is unknown here. Favoriting panes-b lists
// it above panes-c. `Alt+;` then splits panes-a's pane, and the picker's first
// row, panes-b, loads into the new pane on the right and is unfavorited again.
const SPLIT_AND_PICK_STEPS: SelfTestStep[] = [
  stepNextTo('panes-b'),
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-b' },
  stepNextTo('panes-a'),
  { keys: ['<A-;>'], expect: '[sessions] pane split right' },
  {
    keys: ['Enter'],
    expect: '[sessions] pane loaded panes-b',
    screenshot: 'panes-side-by-side',
  },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-b' },
];

// `Alt+h` leaves panes-b's pane for panes-a's, and `Ctrl+Alt+l` swaps
// panes-a to the right.
const FOCUS_AND_SWAP_STEPS: SelfTestStep[] = [
  { keys: ['<A-h>'], expect: '[sessions] pane focused panes-a' },
  { keys: ['<C-A-l>'], expect: '[sessions] panes swapped' },
];

// `Alt+'` splits panes-a's pane with panes-c, the one row no pane shows, below
// it, `Alt+Shift+j` moves the divider between them, and `Alt+k` focuses panes-a
// again, whose pane then draws its lower focus edge.
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

// `Space b r` renames panes-a, focused since the stacked resize, and a second
// `Space b r` with the box emptied hands its naming back to the agent.
const RENAME_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'b', 'r', ...RENAMED, 'Enter'],
    expect: `[sessions] renamed panes-a to "${RENAMED}"`,
  },
  {
    keys: [
      ' ',
      'b',
      'r',
      ...Array<string>(RENAMED.length).fill('Backspace'),
      'Enter',
    ],
    expect: '[sessions] cleared the user title of panes-a',
  },
];

// With panes-a focused over panes-c since the stacked resize, `Space p f`
// favorites panes-a, alone at both edges; `Alt+j` focuses panes-c, whose project
// joins the favorites and moves above panes-a. Both are then unfavorited, so the
// script ends with no favorites and panes-a focused.
const PROJECTS_STEPS: SelfTestStep[] = [
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-a' },
  { keys: [' ', 'p', 'k'], expect: '[sessions] panes-a cannot move up' },
  { keys: [' ', 'p', 'j'], expect: '[sessions] panes-a cannot move down' },
  { keys: ['<A-j>'], expect: '[sessions] pane focused panes-c' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-c' },
  {
    keys: [' ', 'p', 'k'],
    expect: '[sessions] moved panes-c up',
    screenshot: 'project-groups',
  },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-c' },
  { keys: ['<A-k>'], expect: '[sessions] pane focused panes-a' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-a' },
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

// After the close, panes-b's pane sits left of panes-c's, the focused one, and
// panes-a is in no pane. Favoriting panes-c then panes-b and closing panes-b's
// pane draws panes-c, panes-b, panes-a, whatever the stamps, the reverse of
// main's panes-a, panes-b, panes-c, so each `Alt+Shift+o` lands where main's
// order would not. With panes-c unfavorited and shown, the split picker lists
// panes-b, the one favorite, above panes-a, main's first. Unfavoriting panes-b
// leaves the script with no favorites.
const DRAWN_ORDER_STEPS: SelfTestStep[] = [
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-c' },
  { keys: ['<A-h>'], expect: '[sessions] pane focused panes-b' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-b' },
  { keys: ['<A-w>'], expect: '[sessions] pane closed' },
  { keys: ['<A-S-o>'], expect: '[sessions] activated panes-b' },
  { keys: ['<A-S-o>'], expect: '[sessions] activated panes-a' },
  { keys: ['<A-S-o>'], expect: '[sessions] activated panes-c' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-c' },
  { keys: ['<A-;>'], expect: '[sessions] pane split right' },
  { keys: ['Enter'], expect: '[sessions] pane loaded panes-b' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-b' },
];

// After the drawn order, panes [c | b] with panes-b focused and no favorites.
// Favoriting panes-b, then panes-c from its pane, draws panes-b, panes-c, then
// panes-a; `Alt+h` past panes-c's pane reaches the list, its cursor on the
// selected panes-c. `Enter` on panes-a loads it into the focused pane, leaving
// panes [c | a] with panes-a focused, and Esc and `Alt+l` leave the list too.
const LIST_KEYS_STEPS: SelfTestStep[] = [
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-b' },
  {
    keys: ['<A-h>'],
    expect: '[sessions] pane focused panes-c',
    alsoExpect: [/\[sessions\] keys to pane panes-c/],
    why: 'A pane key moves the keys into the pane it focuses, as a click does.',
  },
  { keys: [' ', 'p', 'f'], expect: '[sessions] favorited panes-c' },
  {
    keys: ['<A-h>'],
    expect: '[sessions] list focused on panes-c',
    screenshot: 'list-cursor',
  },
  { keys: ['j'], expect: '[sessions] list cursor on panes-a' },
  { keys: ['g', 'g'], expect: '[sessions] list cursor on panes-b' },
  { keys: ['G'], expect: '[sessions] list cursor on panes-a' },
  { keys: ['k'], expect: '[sessions] list cursor on panes-c' },
  { keys: ['k'], expect: '[sessions] list cursor on panes-b' },
  { keys: ['l'], expect: '[sessions] activated panes-b' },
  {
    keys: ['j'],
    expect: '[sessions] list cursor on panes-c',
    why: 'The list keeps the keys after l.',
  },
  { keys: ['G'], expect: '[sessions] list cursor on panes-a' },
  {
    keys: ['Enter'],
    expect: '[sessions] list left',
    alsoExpect: [/\[sessions\] activated panes-a/],
  },
  { keys: ['<A-h>'], expect: '[sessions] pane focused panes-c' },
  { keys: ['<A-h>'], expect: '[sessions] list focused on panes-c' },
  { keys: ['Escape'], expect: '[sessions] list left' },
  { keys: ['<A-h>'], expect: '[sessions] list focused on panes-c' },
  { keys: ['<A-l>'], expect: '[sessions] list left' },
];

// With panes [c | a], panes-c focused and favorites [b, c], the row keys act on
// the cursor's row: panes-c moves above panes-b, panes-a joins the favorites
// and leaves them, is renamed and named back, then closed, its row leaving
// moving the cursor to panes-b. panes-b stays the one favorite, drawn above
// panes-c.
const LIST_ROW_KEYS_STEPS: SelfTestStep[] = [
  { keys: ['<A-h>'], expect: '[sessions] list focused on panes-c' },
  { keys: ['K'], expect: '[sessions] moved panes-c up' },
  { keys: ['K'], expect: '[sessions] panes-c cannot move up' },
  { keys: ['j'], expect: '[sessions] list cursor on panes-b' },
  { keys: ['J'], expect: '[sessions] panes-b cannot move down' },
  { keys: ['j'], expect: '[sessions] list cursor on panes-a' },
  { keys: ['J'], expect: '[sessions] panes-a is not a favorite' },
  { keys: ['s'], expect: '[sessions] favorited panes-a' },
  {
    keys: ['K'],
    expect: '[sessions] moved panes-a up',
    screenshot: 'list-favorite-prompt',
  },
  { keys: ['s'], expect: '[sessions] unfavorited panes-a' },
  {
    keys: ['r', ...RENAMED, 'Enter'],
    expect: `[sessions] renamed panes-a to "${RENAMED}"`,
  },
  {
    keys: ['r', ...Array<string>(RENAMED.length).fill('Backspace'), 'Enter'],
    expect: '[sessions] cleared the user title of panes-a',
    why: 'The rename dialog gives the keys back to the list.',
  },
  {
    keys: ['d'],
    expect: '[sessions] list cursor on panes-b',
    why: "Closing the cursor's last row moves the cursor to the row before.",
  },
  { keys: ['g', 'g'], expect: '[sessions] list cursor on panes-c' },
  { keys: ['s'], expect: '[sessions] unfavorited panes-c' },
  { keys: ['Escape'], expect: '[sessions] list left' },
];

// In a window too narrow for the side bar beside the panes, `Space k s` opens
// it over them with the keys in the list, its cursor on panes-c, and Enter
// shows panes-b, the favorite above it, and closes it. Back at the start width
// the list is a stop beside the panes again. Unfavoriting panes-b ends the
// script with no favorites and one pane, panes-b, focused.
const LIST_OVERLAY_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'k', 's'],
    expect: '[sessions] list focused on panes-c',
    width: 600,
  },
  { keys: ['k'], expect: '[sessions] list cursor on panes-b' },
  {
    keys: ['Enter'],
    expect: '[sessions] list left',
    alsoExpect: [/\[page\] side bar hidden/, /\[sessions\] activated panes-b/],
  },
  {
    keys: ['<A-h>'],
    expect: '[sessions] list focused on panes-b',
    width: 'start',
    why: 'Back at the start width the side bar lies beside the pane again.',
  },
  { keys: ['Escape'], expect: '[sessions] list left' },
  { keys: [' ', 'p', 'f'], expect: '[sessions] unfavorited panes-b' },
];

// Each run ends the sessions the run before opened and opens three in project
// dirs `panes-a`, `panes-b` and `panes-c`, unselected, in that row order, then
// activates panes-a's row. The result check reads main's state: the list's
// `d` closed panes-a's session, and every other key left panes-b's and
// panes-c's in place. It then ends them, so the scripts after this one start
// with no pane but the last.
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
        why: '<Leader>br renames the focused session and an empty name hands naming back.',
        steps: RENAME_STEPS,
      },
      {
        name: 'projects',
        why: 'Favorites toggle and reorder by key, and the side bar draws sections.',
        steps: PROJECTS_STEPS,
      },
      {
        name: 'cancel and close',
        why: 'Esc undoes a split and Alt+w closes only the pane.',
        steps: CANCEL_AND_CLOSE_STEPS,
      },
      {
        name: 'drawn order',
        why: "The session step keys and the split picker follow the drawn order, not main's.",
        steps: DRAWN_ORDER_STEPS,
      },
      {
        name: 'list keys',
        why: 'Option+h past the leftmost pane reaches the Sessions list, whose cursor walks the session rows and shows a row by Enter or l.',
        steps: LIST_KEYS_STEPS,
      },
      {
        name: 'list row keys',
        why: "s, K, J, r and d act on the cursor's row, not the focused pane's session.",
        steps: LIST_ROW_KEYS_STEPS,
      },
      {
        name: 'list overlay',
        why: 'In a window too narrow for the side bar, Space k s opens the list over the panes with the keys in it, and Enter closes it.',
        steps: LIST_OVERLAY_STEPS,
      },
    ],
    problems: () => {
      const rowIds = new Set(state().rows.map((row) => row.sessionId));
      const problems = opened.flatMap((session, index) => {
        const { id } = session.session;
        const isClosedByTheList = PROJECT_DIRS[index] === 'panes-a';
        if (isClosedByTheList === rowIds.has(id)) {
          return [
            isClosedByTheList
              ? `session ${id} is still in main's rows after the list closed it`
              : `session ${id} left main's rows`,
          ];
        }
        return [];
      });
      endOpened();
      return problems;
    },
  };
}
