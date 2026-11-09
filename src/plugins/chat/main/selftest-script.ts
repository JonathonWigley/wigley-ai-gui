import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AgentHarness } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  FAKE_BLOCKS_TEXT,
  FAKE_COLD_TEXT,
  FAKE_END_TEXT,
  FAKE_HISTORY_IMAGES,
  FAKE_HOLD_TEXT,
  FAKE_PAST_SESSIONS,
  FAKE_PERMISSION_TEXT,
  FAKE_SIGN_IN_CODE,
  FAKE_STEPS_TEXT,
  FAKE_TOOL_TEXT,
  FAKE_VISUAL_TEXT,
  type FakeAgentCall,
  type FakeAgentProcessRecord,
  type FakePermissionAsk,
  isFakeAgentHarness,
  markRun,
  type RunMark,
} from '../../../shared/fake-agent-harness';
import {
  SAMPLE_FLOWCHART_VISUAL,
  SAMPLE_MOCKUP_VISUAL,
} from '../../../shared/sample-visuals';
import type {
  ConnectedSession,
  SessionsMainExports,
  ToolCallContext,
  ToolResult,
} from '../../sessions/contract';
import type { ChatSessions } from './chat-sessions';
import { askFixturePermission } from './fixtures';
import { PERMISSION_TOOL_NAME } from './permission-tool';

// The names of the self-test's project folders, made under the self-test's
// home so the start prompt's folder step, which leaves out missing folders,
// lists them. The fake harness spawns nothing in them. The folder's name names
// the session in every page line.
const SELFTEST_PROJECT_NAME = 'chat-selftest';
// A second session whose Chat tab the steps show while the first holds a
// pending permission.
const SECOND_PROJECT_NAME = 'chat-second';
// A third session whose box holds two attached images, for the image viewer's
// remove key. It starts between the other two, so it lists between them and
// chat-second stays the session before chat-selftest, the list wrapping.
const IMAGES_PROJECT_NAME = 'chat-images';
// How long the images session's hold turn may take to report running, and how
// often it is asked.
const RUNNING_TIMEOUT_MS = 10_000;
const RUNNING_POLL_MS = 20;

export interface ChatSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  chat: Pick<
    ChatSessions,
    | 'start'
    | 'closed'
    | 'permissionToolSession'
    | 'sessions'
    | 'setArchived'
    | 'addSendGate'
    | 'send'
    | 'interrupt'
  >;
  sessions: Pick<SessionsMainExports, 'activate' | 'connect'>;
  harnesses: readonly AgentHarness[];
}

interface ChatSelfTestResult {
  // The self-test project's folder.
  selftest: string;
  permission: ToolResult;
  // Null when no fake process was found to join.
  round: ToolResult | null;
}

const ROUND_HEADING = 'Chat self-test round';

const PERMISSION_INPUT = { command: 'rm selftest.txt' };
const ALLOW_REPLY = JSON.stringify({
  behavior: 'allow',
  updatedInput: PERMISSION_INPUT,
});

// Types the text in insert mode, Esc to normal mode, where Enter in the box
// sends.
const sendKeys = (text: string) => ['i', ...text, 'Escape', 'Enter'];

// Thirty paragraphs, so the message and its echo make the transcript several
// sheets tall.
const LONG_PARAGRAPHS = Array.from(
  { length: 30 },
  (_, index) => `${index + 1}`,
);
const LONG_TEXT = LONG_PARAGRAPHS.join('\n\n');
// Shift+Enter in insert mode breaks the line.
const LONG_KEYS = [
  'i',
  ...LONG_PARAGRAPHS.flatMap((paragraph, index) => [
    ...(index === 0 ? [] : ['<S-Enter>', '<S-Enter>']),
    ...paragraph,
  ]),
  'Escape',
  'Enter',
];

// The line an account command's notice adds; the notice's text is not logged.
const NOTICE_LINE = '[chat] notice entry added in chat-selftest';
const SIGN_IN_LINK_LINE = '[chat] sign-in link shown for work';
// The dialog's line for a sign-in that ended with no error, signed in.
const SIGNED_IN_LINE = '[chat] signed in to work';

// Each step expects the last line its keys cause: the fake emits in microtasks,
// so an earlier line can land before the step's wait begins. Each session opens
// on its Chat tab, and the first session holds the fixture's pending
// permission.
const TWO_SESSIONS_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: ['y'],
    expect: '[chat] nothing to copy',
    why: "The first session's pending permission stays pending.",
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: ['e'], expect: '[chat] picker shown: Effort' },
  { keys: ['<A-S-i>'], expect: '[chat] picker closed: Effort' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  { keys: [' ', 'b', 'n'], expect: '[chat] picker shown: Folder' },
  {
    keys: ['<A-S-i>'],
    expect: '[chat] Chat tab shown in chat-second',
    why: "The start prompt stays open over the second session's Chat tab.",
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  {
    keys: ['i', ...'hi', 'Escape', 'v', '<A-S-i>'],
    expect: '[chat] Chat tab shown in chat-second',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
  {
    keys: ['i', ...'ok', 'Escape', 'Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
    why: 'Back on the first session, i leaves visual mode and inserts before the cursor, so ok sends hoki.',
  },
];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The line the Chat page logs when chat's activity on the named session's row
// changes; `none` for no activity.
const rowActivityLine = (name: string, word: string) =>
  `[chat] row activity ${name} ${word}`;
const rowActivityPattern = (name: string, word: string) =>
  new RegExp(`^${escapeRegExp(rowActivityLine(name, word))}$`);

// The fake's visual turn holds for a second and a half, so the second
// session's turn ends after the first session's Chat tab shows.
const ROW_ACTIVITY_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: [...sendKeys(FAKE_VISUAL_TEXT), '<A-S-o>'],
    expect: rowActivityLine('chat-second', 'done'),
    alsoExpect: [
      rowActivityPattern('chat-second', 'working'),
      /^\[chat\] Chat tab shown in chat-selftest$/,
    ],
    why: 'The turn ends while the first session is focused.',
  },
  {
    keys: ['<A-S-i>'],
    expect: rowActivityLine('chat-second', 'none'),
    alsoExpect: [/^\[chat\] Chat tab shown in chat-second$/],
    why: 'Focusing the session views its finished turn.',
  },
  {
    keys: sendKeys('seen'),
    expect: rowActivityLine('chat-second', 'none'),
    alsoExpect: [rowActivityPattern('chat-second', 'working')],
    why: 'A turn that ends in the focused session skips done.',
  },
  {
    keys: sendKeys(FAKE_PERMISSION_TEXT),
    expect: rowActivityLine('chat-second', 'needs you'),
    alsoExpect: [rowActivityPattern('chat-second', 'working')],
    why: 'The fake asks a permission mid-turn.',
  },
  {
    keys: ['Escape', 'y'],
    expect: rowActivityLine('chat-second', 'none'),
    alsoExpect: [/^\[chat\] allowed Bash in chat-second$/],
    why: 'Allowing it lets the turn end in the focused session.',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

// The second session's process ends here, leaving its row resting until the
// next message there starts it again; its processes' calls are not checked.
const RESTING_SESSION_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: sendKeys(FAKE_END_TEXT),
    expect: '[chat] chat-second rested',
    alsoExpect: [rowActivityPattern('chat-second', 'error')],
    why: 'The process stops while its turn runs, so the row shows error though the session is focused.',
  },
  {
    keys: [' ', 'c', 'e'],
    expect: '[chat] chat-second has no running process',
    why: "The resting tab's box opens no control picker.",
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['j'],
    expect: '[chat] focused notice entry',
    why: 'The exit notice follows the sent message.',
  },
  {
    keys: sendKeys('again'),
    expect: '[chat] assistant entry added in chat-second',
    alsoExpect: [rowActivityPattern('chat-second', 'none')],
    why: 'The send starts the process again in the same row and clears its error.',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

// A host id: the self-test's sessions carry random ones.
const HOST_ID = '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}';

// The notes page's line for its row moving to the random host id a clear
// gives it.
const NOTES_MOVED_TO_NEW_HOST = new RegExp(
  `^\\[notes\\] session moved to ${HOST_ID}$`,
);

// Clears the second session: a clear in the first would replace the process
// whose calls the run checks at its end.
const CLEAR_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: sendKeys('/clear'),
    expect: '[chat] conversation cleared in chat-second',
    alsoExpect: [NOTES_MOVED_TO_NEW_HOST],
    checksFit: true,
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

// The line the visual frames service logs when the frame of `source`
// loads: the first eight hex characters of the source's SHA-256. The source
// a fence hands its contribution is the block's content, which ends with a
// newline.
const frameLoadedLine = (source: string) =>
  `[visual] visual frame loaded: ${createHash('sha256')
    .update(`${source}\n`)
    .digest('hex')
    .slice(0, 8)}`;

// Each sample visual mounted, then its frame loaded.
const VISUALS_DRAWN: RegExp[] = [
  /^\[visual\] visual mounted: Settings panel$/,
  /^\[visual\] visual mounted: Visual flow$/,
];
const FRAMES_LOADED = [SAMPLE_MOCKUP_VISUAL, SAMPLE_FLOWCHART_VISUAL].map(
  (source) => new RegExp(`^${escapeRegExp(frameLoadedLine(source))}$`),
);

// The fake's visual reply in the second session, whose calls the run does not
// check. The screenshot waits for both frames to load.
const VISUAL_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: sendKeys(FAKE_VISUAL_TEXT),
    expect: '[chat] result entry added in chat-second',
    alsoExpect: [...VISUALS_DRAWN, ...FRAMES_LOADED],
    checksFit: true,
    screenshot: 'visuals',
    why: "The mockup's block closes while the reply streams, and the flowchart's closes with the final entry after the fake's hold; both frames load before the screenshot.",
  },
  {
    keys: ['Escape'],
    expect: '[chat] left the box',
    why: 'The result is no stop, so focus follows the reply holding both visuals.',
  },
  {
    keys: ['w'],
    expect: '[visual] visual width: wide',
    screenshot: 'visual-wide',
    why: "From the rest position, the reply's last block, w widens the second visual to the column's whole width.",
  },
  {
    keys: ['w'],
    expect: '[visual] visual width: reading',
    why: 'A second w takes the same visual back to the reading width.',
  },
  {
    keys: ['v'],
    expect: '[visual] visual overlay showing 2 of 2',
    why: "From the rest position, the reply's last block, v opens on the second visual.",
  },
  { keys: ['Escape'], expect: '[visual] visual overlay closed' },
  {
    keys: ['K', 'J', 'v'],
    expect: '[visual] visual overlay showing 1 of 2',
    why: "Focus rests on the reply's last block, the second visual, where v would open on that one, so K J first moves the cursor to the reply's first block.",
  },
  { keys: ['l'], expect: '[visual] visual overlay showing 2 of 2' },
  { keys: ['l'], expect: '[visual] no next visual' },
  { keys: ['h'], expect: '[visual] visual overlay showing 1 of 2' },
  { keys: ['h'], expect: '[visual] no previous visual' },
  { keys: ['Escape'], expect: '[visual] visual overlay closed' },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

// The fake's blocks reply in the second session, whose calls the run does not
// check. Every move logs its stop's entry kind, so a step tells a block move
// from a message move by the kind it lands on.
const BLOCK_CURSOR_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: sendKeys(FAKE_BLOCKS_TEXT),
    expect: '[chat] result entry added in chat-second',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['K'],
    expect: '[chat] focused user entry',
    why: "From the reply's last block, K leaves the reply for the message before it.",
  },
  {
    keys: ['J'],
    expect: '[chat] focused assistant entry',
    why: "J lands on the reply's first block.",
  },
  {
    keys: ['j'],
    expect: '[chat] focused assistant entry',
    why: 'j moves to the second block of the same reply.',
  },
  {
    keys: ['k'],
    expect: '[chat] focused assistant entry',
    why: 'k moves back to the first block, still in the reply.',
  },
  {
    keys: ['k'],
    expect: '[chat] focused user entry',
    why: 'One more k leaves the first block, so j moved by one block and not to the next stop past the reply.',
  },
  { keys: ['J'], expect: '[chat] focused assistant entry' },
  {
    keys: ['V', 'j'],
    expect: '[chat] focused assistant entry',
    alsoExpect: [/^\[chat\] toggled the range$/],
    why: 'V anchors a range on the first block and j extends it.',
  },
  {
    keys: ['Escape'],
    expect: '[chat] cancelled the range',
    why: 'Esc on the page ends the open range.',
  },
  {
    keys: ['Escape'],
    expect: '[chat] no range to cancel in chat-second',
    why: 'The range is gone, so Esc only says so.',
  },
  { keys: ['V'], expect: '[chat] toggled the range' },
  {
    keys: ['V'],
    expect: '[chat] toggled the range',
    why: 'A second V ends the range the first opened.',
  },
  {
    keys: ['Escape'],
    expect: '[chat] no range to cancel in chat-second',
    why: 'Esc finds no range, so the second V ended it.',
  },
  {
    keys: ['V', 'j', 'y'],
    expect: '[chat] copied 2 blocks in chat-second',
    why: "y copies the range's two blocks, through the self-test's clipboard, which leaves the system clipboard alone.",
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

// Back in chat-second, G rests on the reply's last block, the details block.
const BLOCK_EXPANDER_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  { keys: ['Escape', 'G'], expect: '[chat] following the latest entry' },
  {
    keys: ['Enter'],
    expect: '[chat] expanded assistant block',
    screenshot: 'block-expanded',
  },
  { keys: ['Enter'], expect: '[chat] collapsed assistant block' },
  {
    keys: ['k'],
    expect: '[chat] focused assistant entry',
    why: "k moves to the reply's code block, which holds no expander.",
  },
  {
    keys: ['Enter'],
    expect: '[chat] assistant entry has nothing to expand',
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];

const SENDING_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys('hello'),
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['i', ...'one', '<S-Enter>', ...'two', 'Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
    why: 'Shift+Enter in insert mode breaks the line and Enter sends, so one and two go as one message.',
  },
  {
    keys: [...'hello', '<D-Enter>'],
    expect: '[chat] assistant entry added in chat-selftest',
    why: 'Enter in insert mode left the box in insert mode.',
  },
  { keys: ['Escape', 'Escape'], expect: '[chat] left the box' },
];

// A fake permission turn's card, newer than the fixture's, with the cursor on
// it: Esc leaves the box on the card, k goes to its user entry and j back.
const NEWER_CARD_FOCUSED_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys(FAKE_PERMISSION_TEXT),
    expect: '[chat] permission entry added in chat-selftest',
  },
  { keys: ['Escape', 'k'], expect: '[chat] focused user entry' },
  { keys: ['j'], expect: '[chat] focused permission entry' },
];

const PERMISSION_CURSOR_STEPS: SelfTestStep[] = [
  ...NEWER_CARD_FOCUSED_STEPS,
  {
    keys: ['y'],
    expect: '[chat] result entry added in chat-selftest',
    alsoExpect: [/^\[chat\] allowed Bash in chat-selftest$/],
  },
  ...NEWER_CARD_FOCUSED_STEPS,
  { keys: ['n'], expect: '[chat] deny reason box shown for Bash' },
  {
    keys: ['<D-Enter>'],
    expect: '[chat] result entry added in chat-selftest',
    alsoExpect: [/^\[chat\] denied Bash in chat-selftest$/],
  },
];

const PERMISSION_CARD_STEPS: SelfTestStep[] = [
  {
    keys: ['y'],
    expect: `[forms] form shown: chat-selftest · ${ROUND_HEADING}`,
    alsoExpect: [rowActivityPattern('chat-selftest', 'none')],
    why: 'The row showed needs you from the start; the answered permission leaves the focused session idle.',
  },
  {
    keys: [' ', 'b', 'p'],
    expect: '[sessions] hid Form popup in chat-selftest',
    alsoExpect: [/^\[chat\] Chat tab shown in chat-selftest$/],
  },
  {
    keys: ['G'],
    expect: '[chat] following the latest entry',
    why: 'The chat scope holds the keys while the popup is hidden.',
  },
  {
    keys: [' ', 'b', 'p'],
    expect: '[sessions] opened Form popup in chat-selftest',
  },
  {
    keys: [' ', ' '],
    expect: '[forms] review opened',
    screenshot: 'form-popup-over-chat',
  },
  {
    keys: ['<D-Enter>'],
    expect: '[chat] Chat tab shown in chat-selftest',
    checksFit: true,
  },
];

// The dock draws its finished line before the idle line is logged.
const TRANSCRIPT_FOCUS_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys(FAKE_TOOL_TEXT),
    expect: '[chat] chat-selftest is idle',
    alsoExpect: [/^\[chat\] result entry added in chat-selftest$/],
    checksFit: true,
    screenshot: 'dock-done',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['k'], expect: '[chat] focused user entry' },
  { keys: ['j'], expect: '[chat] focused assistant entry' },
  { keys: ['g', 'g'], expect: '[chat] focused the first entry' },
  { keys: ['G'], expect: '[chat] following the latest entry' },
];

// The steps turn's last step is its one thought, so the thought's line marks
// the whole run arrived.
const ACTIVITY_DOCK_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys(FAKE_STEPS_TEXT),
    expect: '[chat] thinking entry added in chat-selftest',
    checksFit: true,
    screenshot: 'dock-live',
  },
  {
    keys: ['<C-c>'],
    expect: '[chat] chat-selftest is idle',
    alsoExpect: [new RegExp(`^${escapeRegExp(NOTICE_LINE)}$`)],
    screenshot: 'dock-after-interrupt',
    why: "The fake's notice lands before the idle line, and the dock hides before the idle line is logged.",
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['k'], expect: '[chat] focused user entry' },
  { keys: ['G'], expect: '[chat] following the latest entry' },
];

const TRANSCRIPT_SCROLL_STEPS: SelfTestStep[] = [
  {
    keys: LONG_KEYS,
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: ['Escape'],
    expect: '[chat] left the box',
    why: 'Leaving the box resizes the sheet, and the transcript stays at the bottom, following.',
  },
  {
    keys: ['<C-S-k>'],
    expect: '[chat] scrolled the transcript up half a page; not following',
  },
  {
    keys: ['<C-S-j>'],
    expect:
      '[chat] scrolled the transcript down half a page to the bottom; following the latest entry',
  },
  {
    keys: ['<C-k>'],
    expect: '[chat] scrolled the transcript up a line; not following',
  },
  {
    keys: ['<C-j>'],
    expect:
      '[chat] scrolled the transcript down a line to the bottom; following the latest entry',
  },
];

const HUB_ENTERED = '[chat] focused the session hub in chat-selftest';
const BOX_FOCUSED = '[chat] focused the box in chat-selftest';
const BACK_ON_ENTRIES = '[chat] cursor back on the entries in chat-selftest';
const linePattern = (line: string) => new RegExp(`^${escapeRegExp(line)}$`);

// Starts and ends with the transcript holding the keys, the box blurred in
// normal mode and the hub shown at its default width, every section expanded.
// The hub hides in a Chat tab under 640 px, so the group runs wide.
const PANE_KEYS_STEPS: SelfTestStep[] = [
  {
    keys: ['<A-l>'],
    expect: HUB_ENTERED,
    width: 1400,
    screenshot: 'hub-cursor',
  },
  {
    keys: ['G'],
    expect: '[chat] hub cursor on Main agent',
    why: "G goes to the last section with a head: Main agent, the only one this session shows, since chat's Session header has none.",
  },
  {
    keys: ['j'],
    expect: '[chat] hub cursor on Main agent',
    why: 'j on the last section stays.',
  },
  {
    keys: ['k'],
    expect: '[chat] hub cursor on Main agent',
    why: 'k on the first section stays: the cursor passes over the Session header.',
  },
  { keys: ['Enter'], expect: '[chat] section Main agent collapsed' },
  { keys: ['l'], expect: '[chat] section Main agent expanded' },
  {
    keys: ['<C-j>'],
    expect: '[page] <C-j> ran chat.hubLineDown',
    alsoExpect: [
      /^\[chat\] (scrolled )?the Main agent section (did not scroll )?down/,
    ],
  },
  {
    keys: ['<A-S-h>'],
    expect: '[page] <A-S-h> ran panes.resizePaneLeft',
    alsoExpect: [/^\[chat\] session hub width 288$/],
    why: "The hub's divider is the resize target, widening the hub from its 264.",
  },
  {
    keys: ['<A-S-l>'],
    expect: '[page] <A-S-l> ran panes.resizePaneRight',
    alsoExpect: [/^\[chat\] session hub width 264$/],
  },
  {
    keys: ['<A-h>'],
    expect: BACK_ON_ENTRIES,
    why: 'Alt+h returns to the transcript the hub was entered from.',
  },
  { keys: ['<A-j>'], expect: BOX_FOCUSED },
  { keys: ['<A-k>'], expect: '[chat] left the box' },
  {
    keys: ['i', '<A-k>'],
    expect: '[chat] left the box',
    alsoExpect: [linePattern(BOX_FOCUSED)],
    why: 'i enters insert mode, and Alt+k leaves the box from it.',
  },
  {
    keys: ['<A-j>', 'Escape'],
    expect: '[chat] left the box',
    alsoExpect: [linePattern(BOX_FOCUSED)],
    why: 'One Esc leaves the box, so Alt+k had left insert mode.',
  },
  {
    keys: ['<A-j>', '<A-l>'],
    expect: HUB_ENTERED,
    alsoExpect: [linePattern(BOX_FOCUSED)],
  },
  {
    keys: ['<A-h>'],
    expect: BOX_FOCUSED,
    why: 'Alt+h returns to the box the hub was entered from.',
  },
  {
    keys: ['Escape', '<A-l>', 'Escape'],
    expect: BACK_ON_ENTRIES,
    alsoExpect: [linePattern('[chat] left the box'), linePattern(HUB_ENTERED)],
    why: 'Esc in the hub always goes to the transcript.',
  },
  {
    keys: ['<A-l>', ' ', 'b', 'h'],
    expect: '[chat] session hub hidden',
    alsoExpect: [linePattern(BACK_ON_ENTRIES)],
    why: 'Hiding the hub hands its keys to the transcript.',
  },
  {
    keys: [' ', 'b', 'h'],
    expect: '[chat] session hub shown',
    width: 'start',
    why: 'The hub shows again for the groups after.',
  },
];

const CONTROLS_STEPS: SelfTestStep[] = [
  { keys: ['e'], expect: '[chat] picker shown: Effort', checksFit: true },
  {
    keys: ['j', 'Enter'],
    expect: '[chat] Effort is High in chat-selftest',
    why: 'Effort opens on Medium, so j picks High.',
  },
  {
    keys: ['i', 'Escape', ' ', 'c', 'e'],
    expect: '[chat] picker shown: Effort',
  },
  {
    keys: ['/', ...'low', 'Enter'],
    expect: '[chat] Effort is Low in chat-selftest',
    why: "Enter in the filter's insert mode sets the filtered choice.",
  },
  { keys: ['m'], expect: '[chat] picker shown: Mode' },
  { keys: ['Escape'], expect: '[chat] picker closed: Mode' },
  { keys: ['o'], expect: '[chat] picker shown: Model' },
  {
    keys: ['Escape'],
    expect: '[chat] picker closed: Model',
    screenshot: 'status-line',
    checksFit: true,
  },
  { keys: ['c'], expect: '[chat] picker shown: Controls' },
  { keys: ['Escape'], expect: '[chat] picker closed: Controls' },
];

const INTERRUPT_AND_CLOSE_STEPS: SelfTestStep[] = [
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  { keys: ['<C-c>'], expect: '[chat] notice entry added in chat-selftest' },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  {
    keys: sendKeys('row now'),
    expect: '[chat] 1 pending message(s) in chat-selftest',
  },
  {
    keys: ['Escape', 'G', '<D-Enter>'],
    expect: '[chat] sending a pending message now in chat-selftest',
    alsoExpect: [/^\[chat\] result entry added in chat-selftest$/],
    why: 'Cmd+Enter on the focused pending row, off the box, writes it into the held turn, which the fake takes in and answers, ending the turn.',
  },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] 1 pending message(s) in chat-selftest',
  },
  {
    keys: ['i', ...'box now', '<D-Enter>'],
    expect: '[chat] sending now in chat-selftest',
    alsoExpect: [/^\[chat\] result entry added in chat-selftest$/],
    why: 'Cmd+Enter in the box writes the pending hold and then the box into the held turn; the box message ends the turn.',
  },
  { keys: ['Escape', 'Escape'], expect: '[chat] left the box' },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  {
    keys: sendKeys('pending one'),
    expect: '[chat] 1 pending message(s) in chat-selftest',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: ['G'],
    expect: '[chat] following the latest entry',
    why: 'The latest stop is the pending row, after the entries.',
  },
  {
    keys: ['Enter'],
    expect: '[chat] pulled back 1 message(s) in chat-selftest',
  },
  {
    keys: ['i', 'Escape', 'Enter'],
    expect: '[chat] 1 pending message(s) in chat-selftest',
    why: 'The box holds the pulled-back message.',
  },
  {
    keys: sendKeys('pending two'),
    expect: '[chat] 2 pending message(s) in chat-selftest',
    checksFit: true,
    screenshot: 'pending-rows',
  },
  {
    keys: ['<C-c>'],
    expect: '[chat] pulled back 2 message(s) in chat-selftest',
  },
  {
    keys: ['Enter'],
    expect: '[chat] assistant entry added in chat-selftest',
    why: 'The box holds both pulled-back messages, the oldest on top, and sends them as one.',
  },
  { keys: ['Escape'], expect: '[chat] left the box' },
  {
    keys: [' ', 'b', 'n'],
    expect: '[chat] picker shown: Folder',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  {
    keys: sendKeys(FAKE_COLD_TEXT),
    expect: '[chat] assistant entry added in chat-selftest',
  },
  {
    keys: sendKeys('after cold'),
    expect: '[chat] 1 pending message(s) in chat-selftest',
    alsoExpect: [/^\[chat\] chat-selftest compacting: selftest · cache cold$/],
    why: "The fixture gate holds the send after fake: cold; the held row waits while the fake holds the app compaction, and the page logs the compaction's label as it starts.",
  },
  {
    keys: sendKeys('behind hold'),
    expect: '[chat] 2 pending message(s) in chat-selftest',
    why: 'A send during the hold queues behind the held row.',
  },
  {
    keys: ['<C-c>'],
    expect: '[chat] 0 pending message(s) in chat-selftest',
    alsoExpect: [
      /^\[chat\] interrupted chat-selftest$/,
      /^\[chat\] chat-selftest compaction ended$/,
    ],
    why: 'Ctrl+C skips the held compaction; the held row is written when the compaction ends, then the row behind it at the next idle.',
  },
  {
    keys: sendKeys(FAKE_HOLD_TEXT),
    expect: '[chat] chat-selftest is working',
  },
  {
    keys: ['<D-w>'],
    expect: '[chat] closing the session asks to end chat-selftest',
    checksFit: true,
  },
  { keys: ['y'], expect: '[chat] session closed: chat-selftest' },
];

// Relative to the self-test's temp home, as `writeFile` takes it.
const SETTINGS_FILE = '.config/wigley-ai-gui/settings.json';
// One folder project on the self-test's folder, with no fixed profile.
const PROJECT_SETTINGS = JSON.stringify({
  chat: {
    projects: [
      { name: 'Self-test project', folder: `~/${SELFTEST_PROJECT_NAME}` },
    ],
  },
});
const NO_SETTINGS = '{}';

const PROJECT_STEP_STEPS: SelfTestStep[] = [
  {
    writeFile: { path: SETTINGS_FILE, text: PROJECT_SETTINGS },
    keys: [],
    expect: '[config] applied a new config',
  },
  {
    keys: [' ', 'b', 'n'],
    expect: '[chat] picker shown: Project',
    checksFit: true,
    why: 'With a project in the settings, the start prompt opens on the Project step.',
  },
  {
    keys: ['Enter'],
    expect: '[chat] picker shown: Profile',
    why: 'The cursor opens on the first project, below the section rows; the project fixes no profile, so the Profile step follows.',
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Profile' },
  { keys: [' ', 'b', 'n'], expect: '[chat] picker shown: Project' },
  {
    keys: ['/', ...'Other folder', 'Enter'],
    expect: '[chat] picker shown: Folder',
    why: 'The Project step lists Other folder…, which opens the Folder step.',
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  {
    writeFile: { path: SETTINGS_FILE, text: NO_SETTINGS },
    keys: [],
    expect: '[config] applied a new config',
    why: 'No projects again, so the groups after open on the Folder step.',
  },
];

const RESUME_LIST_STEPS: SelfTestStep[] = [
  {
    keys: ['<C-n>'],
    expect: '[chat] picker shown: Folder',
    why: 'Ctrl+n from the Chat tab opens the folder step; the steps below use the session step only Space b n offers.',
  },
  { keys: ['Escape'], expect: '[chat] picker closed: Folder' },
  { keys: [' ', 'b', 'n'], expect: '[chat] picker shown: Folder' },
  {
    keys: ['/', ...SELFTEST_PROJECT_NAME, 'Enter'],
    expect: '[chat] picker shown: Profile',
    why: "The second session's restart made its folder the newest, so the filter picks the self-test's.",
  },
  {
    keys: ['Enter'],
    expect: '[chat] picker shown: Session',
    checksFit: true,
  },
];

const ARCHIVE_STEPS: SelfTestStep[] = [
  {
    keys: ['j', 'j', 'x'],
    expect: '[chat] archived fake past session one',
    why: 'The step opens on New session, with New headless session below it, so the second j reaches the saved session.',
  },
  {
    keys: ['.'],
    expect: '[chat] archived sessions shown',
    checksFit: true,
  },
  { keys: ['k', 'x'], expect: '[chat] restored fake past session one' },
  { keys: ['.'], expect: '[chat] archived sessions hidden' },
  {
    keys: ['Enter'],
    expect: '[chat] Chat tab shown in chat-selftest',
    checksFit: true,
    why: 'Enter resumes the restored session one.',
  },
];

const SLASH_COMPLETION_STEPS: SelfTestStep[] = [
  {
    keys: ['/', 'l', 'o', 'g'],
    expect: '[chat] completions offered: /login, /logout',
  },
  {
    keys: ['<C-n>', '<C-p>', '<C-n>', 'Tab'],
    expect: '[chat] completion accepted: /logout',
    why: "With the popup open Ctrl+n and Ctrl+p move its selection, ahead of the Chat scope's Ctrl+n.",
  },
  {
    keys: ['Escape', 'c', 'c', '/', 'a', 'l', 'i'],
    expect: '[chat] completions offered: /fake-command',
  },
  { keys: ['Tab'], expect: '[chat] completion accepted: /fake-command' },
  {
    keys: ['Escape', 'Enter'],
    expect: '[chat] result entry added in chat-selftest',
  },
];

const ACCOUNT_STATUS_STEPS: SelfTestStep[] = [
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/status'), expect: NOTICE_LINE },
];

const SIGN_IN_STEPS: SelfTestStep[] = [
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE, checksFit: true },
  {
    keys: ['Escape', ' ', 'c', 'y'],
    expect: '[chat] sign-in link copied',
    why: "The dialog's box opens in insert mode, so Esc leaves insert mode before Space c y.",
  },
  {
    keys: ['Escape'],
    expect: '[chat] sign-in for work ended: Sign-in cancelled',
    why: 'Main logs the cancelled end, which it sends the page nothing for.',
  },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: [...FAKE_SIGN_IN_CODE, '<D-Enter>'],
    expect: SIGNED_IN_LINE,
  },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: [...FAKE_SIGN_IN_CODE, 'Escape', 'Enter'],
    expect: SIGNED_IN_LINE,
  },
  { keys: sendKeys('/logout'), expect: NOTICE_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  { keys: [...FAKE_SIGN_IN_CODE, 'Enter'], expect: SIGNED_IN_LINE },
  { keys: sendKeys('/login'), expect: SIGN_IN_LINK_LINE },
  {
    keys: ['x', 'Enter'],
    expect: '[chat] sign-in failed for work: Wrong code',
  },
  {
    keys: sendKeys('/status'),
    expect: NOTICE_LINE,
    why: 'The profile still reads signed in after the wrong code.',
  },
];

const IMAGES_STEPS: SelfTestStep[] = [
  { keys: [' ', 'c', 'x'], expect: '[chat] no attached image' },
  { keys: ['Escape'], expect: '[chat] left the box' },
  { keys: ['g', 'g'], expect: '[chat] focused the first entry' },
  {
    keys: ['Enter'],
    expect: '[chat] image viewer showing 1 of 2',
    checksFit: true,
    why: "The first entry is the resumed history's message with the fake's two images.",
  },
  { keys: ['l'], expect: '[chat] image viewer showing 2 of 2' },
  { keys: ['x'], expect: '[chat] sent images cannot be removed' },
  { keys: ['l'], expect: '[chat] no next image' },
  { keys: ['h'], expect: '[chat] image viewer showing 1 of 2' },
  { keys: ['h'], expect: '[chat] no previous image' },
  { keys: ['Escape'], expect: '[chat] image viewer closed' },
];

// chat-images' box holds the two images its fixture returned there.
const ATTACHMENTS_STEPS: SelfTestStep[] = [
  {
    keys: ['<A-S-o>'],
    expect: '[chat] Chat tab shown in chat-images',
    why: 'The Sessions list shows chat-selftest, chat-images, then chat-second, so chat-images is the next session down.',
  },
  {
    keys: [' ', 'c', 'i'],
    expect: '[chat] image viewer showing 1 of 2',
    checksFit: true,
    screenshot: 'attachments-viewer',
  },
  { keys: ['l'], expect: '[chat] image viewer showing 2 of 2' },
  {
    keys: ['x'],
    expect: '[chat] image viewer showing 1 of 1',
    alsoExpect: [/^\[chat\] removed attached image 2 of 2$/],
  },
  {
    keys: ['x'],
    expect: '[chat] image viewer closed',
    alsoExpect: [/^\[chat\] removed attached image 1 of 1$/],
  },
  { keys: [' ', 'c', 'i'], expect: '[chat] no attached image' },
  {
    keys: ['<A-S-i>'],
    expect: '[chat] Chat tab shown in chat-selftest',
  },
];

const IDLE_CLOSE_STEPS: SelfTestStep[] = [
  { keys: ['<D-w>'], expect: '[chat] session closed: chat-selftest' },
];

// The preview row is named after its folder, `Chat preview`.
const LAYOUT_PREVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'c'],
    expect: '[chat] Chat tab shown in Chat preview',
    alsoExpect: [...VISUALS_DRAWN, ...FRAMES_LOADED],
    screenshot: 'chat-preview',
    why: "The sample's visuals entry mounts both visuals and loads their frames before the screenshot; the streaming entry shows the drawing card.",
  },
  {
    keys: sendKeys('hi'),
    expect: '[chat] sent a message in Chat preview',
  },
  {
    keys: ['Escape', ' ', ';'],
    expect: '[chat] session closed: Chat preview',
    why: 'Esc leaves the box, then Space ; closes the session.',
  },
];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'two sessions',
    why: "Each session keeps its own state across switching Chat tabs: y in the second leaves the first's permission alone, a picker closes, the start prompt stays open, and a box left in visual mode keeps its text and cursor across a blur.",
    steps: TWO_SESSIONS_STEPS,
  },
  {
    name: 'attachments',
    why: "Space c i opens the viewer on the composer's two attached images, x removes the shown one and shows the one before it, a last x closes the viewer, and Space c i then finds none.",
    steps: ATTACHMENTS_STEPS,
  },
  {
    name: 'row activity',
    why: 'the row shows working during a turn, done after it in an unfocused session, nothing once viewed, and needs you while the fake asks a permission mid-turn',
    steps: ROW_ACTIVITY_STEPS,
  },
  {
    name: 'resting session',
    why: "fake: end leaves the second session resting in its row, where the box's control keys log that no process runs, Esc still leaves the box, j still moves through the entries, and the next message starts the process again in place.",
    steps: RESTING_SESSION_STEPS,
  },
  {
    name: 'clear',
    why: '/clear in the second session empties its Chat tab to one notice and restarts its agent, and the notes page moves the row to its new host session id.',
    steps: CLEAR_STEPS,
  },
  {
    name: 'visuals',
    why: "fake: visual draws the settings mockup and the flowchart in chat-second's transcript as live visuals, the second block first showing as the drawing card while the fake holds it open; v from the rest position opens the overlay on the second visual, and on the reply's first block on its first visual, l and h step through both and stop at either end, and Esc closes it.",
    steps: VISUAL_STEPS,
  },
  {
    name: 'block cursor',
    why: "Over fake: blocks' reply of paragraphs, a list and code in chat-second: J and K jump between messages, j and k move by block inside one, V j opens a range that page Esc cancels, page Esc with no range logs that there is none, a second V ends a range, and V j y copies two blocks.",
    steps: BLOCK_CURSOR_STEPS,
  },
  {
    name: 'block expander',
    why: "Enter on fake: blocks' details block opens and closes that one expander; on a block with none it toggles the whole entry, as before.",
    steps: BLOCK_EXPANDER_STEPS,
  },
  {
    name: 'sending',
    why: 'Enter in normal mode and Cmd+Enter in insert mode send from the box, each message drawing its reply, and Esc leaves insert mode then the box.',
    steps: SENDING_STEPS,
  },
  {
    name: 'permission cursor',
    why: "y and n answer the waiting card under the cursor, not the oldest: two fake permission turns each make a newer card, the cursor's card is allowed and then denied while the fixture's card stays waiting for the next group's y.",
    steps: PERMISSION_CURSOR_STEPS,
  },
  {
    name: 'permission card',
    why: "y allows the fixture's permission, whose answer asks a round that opens a popup over the Chat tab, hides for a chat key and opens again, until Cmd+Enter submits it from its review.",
    steps: PERMISSION_CARD_STEPS,
  },
  {
    name: 'transcript focus',
    why: "A tool turn's transcript holds its user and assistant entries only, focus following the assistant: k and j walk them, gg focuses the first entry and G follows the latest; the activity dock shows the finished turn's one line.",
    steps: TRANSCRIPT_FOCUS_STEPS,
  },
  {
    name: 'activity dock',
    why: "A held steps turn draws the live activity dock in the session hub (the time and state word, the main agent's 3 latest tool calls, the counts) with the box focused; Ctrl+C ends it with the fake's notice and no result, so the dock hides; Esc shows the focused entry's left bar; k focuses the user entry and G follows the latest again.",
    steps: ACTIVITY_DOCK_STEPS,
  },
  {
    name: 'transcript scroll',
    why: 'A thirty-paragraph message makes the transcript taller than the sheet; scrolling half a page or a line up off the bottom stops following, and back onto the bottom follows again.',
    steps: TRANSCRIPT_SCROLL_STEPS,
  },
  {
    name: 'pane keys',
    why: 'Alt+l and Alt+h move between the transcript or the box and the session hub, returning to the pane they came from; Alt+j and Alt+k move between the transcript and the box, the box leaving insert mode; in the hub G, j and k walk the section heads, Enter and l fold and unfold one, Ctrl+j scrolls it, Alt+Shift+h and l resize the hub, Esc goes back to the transcript, and Space b h hiding the hub hands the keys back.',
    steps: PANE_KEYS_STEPS,
  },
  {
    name: 'session controls',
    why: "The Effort picker sets the session's effort from the transcript and from the box's normal mode, its filter included; Mode, Model and Controls open and close; the status line draws one model · effort chip.",
    steps: CONTROLS_STEPS,
  },
  {
    name: 'interrupt and close',
    why: "Ctrl+c in the box ends a held turn with the fake's notice; messages sent during a held turn wait as pending rows; Cmd+Enter on a focused row writes that row into the turn, and Cmd+Enter in the box writes every pending row then the box; Enter on one and Ctrl+c pull them back into the box, the oldest on top, and none reaches the process; a send after fake: cold is held as a pending row for an app compaction, a later send queues behind it, and Ctrl+C skips the compaction and writes both in order; Cmd+W on a working session asks before y ends it.",
    steps: INTERRUPT_AND_CLOSE_STEPS,
  },
  {
    name: 'project step',
    why: "With a folder project in chat's projects setting, Space b n opens the Project step, which lists the project and Other folder…: the project leads to the Profile step and Other folder… to the Folder step.",
    steps: PROJECT_STEP_STEPS,
  },
  {
    name: 'resume list',
    why: "The start prompt's folder step, filtered to the self-test's folder, and profile step lead to a session step listing the fake's saved sessions for the self-test's folder.",
    steps: RESUME_LIST_STEPS,
  },
  {
    name: 'archive',
    why: 'x archives and restores a saved session in the resume list, . shows and hides the archived ones, and Enter resumes the restored session.',
    steps: ARCHIVE_STEPS,
  },
  {
    name: 'slash completion',
    why: "Ctrl+n and Ctrl+p move the open popup; / and ali offer the fake's command by its alias alone, Tab accepts it and Esc Enter sends it.",
    steps: SLASH_COMPLETION_STEPS,
  },
  {
    name: 'account status',
    why: 'The fake starts every profile signed in: /status reports it in a notice, /logout signs the work profile out and /status reports that.',
    steps: ACCOUNT_STATUS_STEPS,
  },
  {
    name: 'sign-in',
    why: "/login opens the sign-in dialog on the fake's link, which Space c y copies and Esc cancels; the fake's code signs in sent with Cmd+Enter, Enter from normal mode and Enter from insert mode, and a wrong code fails.",
    steps: SIGN_IN_STEPS,
  },
  {
    name: 'images',
    why: "Space c x finds no attached image; the image viewer opens on the first of a message's two images, steps between them and stops at either end, and Esc closes it; x over a sent message's images removes nothing.",
    steps: IMAGES_STEPS,
  },
  {
    name: 'idle close',
    why: 'Cmd+W closes an idle session without asking.',
    steps: IDLE_CLOSE_STEPS,
  },
  {
    name: 'layout preview',
    why: 'Space z l c opens the sample session with no agent, and a send there sends nothing.',
    steps: LAYOUT_PREVIEW_STEPS,
  },
  {
    name: 'session hub',
    why: 'Space b h hides the session hub in every Chat tab, and again shows it. A split from a focused box hands the keys to its Show session picker, whose Enter chooses rather than reaching the box.',
    steps: [
      {
        keys: ['Escape', ' ', 'b', 'h'],
        expect: '[chat] session hub hidden',
      },
      {
        keys: ['Escape', ' ', 'b', 'h'],
        expect: '[chat] session hub shown',
      },
      {
        keys: ['i', '<A-;>'],
        expect: '[sessions] pane split right',
        alsoExpect: [/^\[chat\] focused the box in /],
        width: 1800,
      },
      {
        keys: ['Enter'],
        expect: '[page] Enter ran sessions.pickerChoose',
      },
      {
        keys: ['<A-w>'],
        expect: '[sessions] pane closed',
        width: 'start',
      },
    ],
  },
  {
    name: 'stop all',
    why: 'Space b X stops every session process; the rows stay, resting.',
    steps: [
      {
        keys: ['Escape', ' ', 'b', 'X'],
        expect: '[chat] stopping every session',
      },
    ],
  },
];

// Raw JSON and tool output scroll in their own box, as code and tables do, the
// activity dock's tool calls and done line end in an
// ellipsis, and the tab bar's parts and the dock's one line clip in their own box.
const SCROLLS_ITSELF = [
  '.chat-json',
  '.chat-tool-result',
  '.md pre',
  '.md table',
  '.chat-working-action',
  '.chat-working-line',
  '.chat-working-done',
  '.session-bar-parts',
];

// The calls the steps cause on the fixture's fake process, in order.
const EXPECTED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: 'hoki', imageCount: 0 },
  { method: 'send', text: 'hello', imageCount: 0 },
  { method: 'send', text: 'one\ntwo', imageCount: 0 },
  { method: 'send', text: 'hello', imageCount: 0 },
  { method: 'send', text: FAKE_PERMISSION_TEXT, imageCount: 0 },
  { method: 'send', text: FAKE_PERMISSION_TEXT, imageCount: 0 },
  { method: 'send', text: FAKE_TOOL_TEXT, imageCount: 0 },
  { method: 'send', text: FAKE_STEPS_TEXT, imageCount: 0 },
  { method: 'interrupt' },
  { method: 'send', text: LONG_TEXT, imageCount: 0 },
  { method: 'setControl', id: 'effort', value: 'high' },
  { method: 'setControl', id: 'effort', value: 'low' },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'interrupt' },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'send', text: 'row now', imageCount: 0 },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'send', text: 'box now', imageCount: 0 },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'interrupt' },
  { method: 'send', text: 'pending one\npending two', imageCount: 0 },
  { method: 'send', text: FAKE_COLD_TEXT, imageCount: 0 },
  { method: 'compact' },
  { method: 'interrupt' },
  { method: 'send', text: 'after cold', imageCount: 0 },
  { method: 'send', text: 'behind hold', imageCount: 0 },
  { method: 'send', text: FAKE_HOLD_TEXT, imageCount: 0 },
  { method: 'end' },
];

const FIXTURE_HOLD_REASON = 'selftest · cache cold';

// The saved session the steps resume, the first of the fake's.
const RESUMED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

// The calls the steps cause on the resumed session's fake process, in order.
const EXPECTED_RESUMED_CALLS: FakeAgentCall[] = [
  { method: 'send', text: '/fake-command ', imageCount: 0 },
  { method: 'end' },
];

// The round the fixture's permission answer asks in the first session. Each
// run's differs in its context, so a later run never opens pre-filled from an
// earlier run's saved draft.
function chatRound(run: number) {
  return {
    heading: ROUND_HEADING,
    overview: 'Opens over the Chat tab until submitted.',
    notices: [],
    questions: [
      {
        title: 'Back to chat',
        context: `Run ${run}: submitted untouched.`,
        summary: 'Pick one.',
        choices: ['Yes', 'No'],
        recommend: 1,
        rationale: 'Yes is the default.',
      },
    ],
  };
}

const toolCallContext = (): ToolCallContext => ({
  toolUseId: null,
  signal: new AbortController().signal,
});

// The last fake process this run started for the self-test's project, resumed
// or new.
function selftestProcess(
  marks: readonly RunMark[],
  projectDir: string,
  resume: boolean,
): FakeAgentProcessRecord | null {
  const records = marks
    .flatMap((mark) => mark.harness.processes.slice(mark.processes))
    .filter(
      (record) =>
        record.request.projectDir === projectDir &&
        record.request.resume === resume,
    );
  return records.at(-1) ?? null;
}

function fixtureProblems(
  { permission, round }: ChatSelfTestResult,
  process: FakeAgentProcessRecord | null,
  projectDir: string,
): string[] {
  const reply = permission.content[0]?.text;
  const problems: string[] = [];
  if (permission.isError === true) {
    problems.push(`${PERMISSION_TOOL_NAME} failed: ${reply}`);
  }
  if (reply !== ALLOW_REPLY) {
    problems.push(`permission reply ${reply}`);
  }
  if (process === null || round === null) {
    problems.push(`no fake process for ${projectDir}`);
    return problems;
  }
  const outcome = round.structuredContent?.outcome;
  if (round.isError === true) {
    problems.push(`ask_round failed: ${round.content[0]?.text}`);
  } else if (outcome !== 'submitted') {
    problems.push(`round outcome ${String(outcome)}`);
  }
  const calls = JSON.stringify(process.calls);
  if (calls !== JSON.stringify(EXPECTED_CALLS)) {
    problems.push(`fake calls ${calls}`);
  }
  if (!process.ended) {
    problems.push('fake process not ended');
  }
  return problems;
}

function resumedProblems(
  process: FakeAgentProcessRecord | null,
  projectDir: string,
): string[] {
  if (process === null) {
    return ['no resumed fake process'];
  }
  const problems: string[] = [];
  const { request } = process;
  const resumesSessionOne =
    request.sessionId === RESUMED_SESSION_ID &&
    request.resume &&
    request.projectDir === projectDir;
  if (!resumesSessionOne) {
    problems.push(`resumed request ${JSON.stringify(request)}`);
  }
  const calls = JSON.stringify(process.calls);
  if (calls !== JSON.stringify(EXPECTED_RESUMED_CALLS)) {
    problems.push(`resumed calls ${calls}`);
  }
  return problems;
}

// Reads only this run's calls.
function pastSessionProblems(
  marks: readonly RunMark[],
  projectDir: string,
): string[] {
  const calls = marks.flatMap((mark) =>
    mark.harness.pastSessionCalls.slice(mark.pastSessionCalls),
  );
  const listedSelftestFolder = calls.some(
    (call) => call.method === 'listSessions' && call.projectDir === projectDir,
  );
  const readResumedHistory = calls.some(
    (call) =>
      call.method === 'history' &&
      call.sessionId === RESUMED_SESSION_ID &&
      call.projectDir === projectDir,
  );
  if (listedSelftestFolder && readResumedHistory) {
    return [];
  }
  return [`past session calls ${JSON.stringify(calls)}`];
}

// Asks a fake process's permission through chat's tool in the running chat
// session in the process's project folder, as Claude Code would; allowed when
// the reply's behavior is allow.
function fakePermissionAsk(
  chat: Pick<ChatSessions, 'permissionToolSession' | 'sessions'>,
): FakePermissionAsk {
  return async (request, call) => {
    const session = chat
      .sessions()
      .find(
        (state) => state.running && state.projectDir === request.projectDir,
      );
    if (session === undefined) {
      throw new Error(`no running chat session in ${request.projectDir}`);
    }
    const reply = await askFixturePermission(
      chat,
      session.sessionId,
      request.projectDir,
      call,
    );
    const text = reply.content[0]?.text ?? '';
    if (reply.isError === true) {
      throw new Error(text);
    }
    const { behavior } = JSON.parse(text) as { behavior: string };
    return behavior === 'allow';
  };
}

// The self-test's three project folders.
interface SelfTestProjects {
  selftest: string;
  second: string;
  images: string;
}

// Makes the three self-test project folders under the home's real path, the
// one the page shows as `~`, then starts three chat sessions each run, first
// closing every session chat holds in a self-test project (a resumed one
// included) and unarchiving the fake's saved sessions: the second project's,
// the images project's, whose box it fills with two returned images, then the
// self-test's, whose Chat tab it shows. Asks one permission prompt through
// chat's tool in the self-test's session, which the steps allow; the answer
// asks a forms round there over a relay that joins the session, which the
// steps submit. The result is both calls' replies and the self-test project's
// folder; problems reads the fake processes, whose records the steps keep
// changing in place, when it runs, reading only the records this run added.
// Each fake harness asks a `fake: permission` turn's permission through
// chat's tool too. The run waits on the session's Chat tab being shown. A
// fixture send gate, registered here once for every run, holds a send to the
// self-test's session that follows `fake: cold`, with the fake holding the
// compaction until problems reads the run; it needs no auto-compact plugin.
export function chatSelfTestScript(deps: ChatSelfTestDeps): SelfTestScript {
  const { chat, sessions, harnesses, files } = deps;
  // Cleared when making them fails, so a later run tries again.
  let made: Promise<SelfTestProjects> | null = null;
  let previousRelay: ConnectedSession | null = null;
  let archiveResetFailures: string[] = [];
  let marks: RunMark[] = [];
  let selftestProject: string | null = null;

  chat.addSendGate((input) => {
    const isSelftestSession = chat
      .sessions()
      .some(
        (state) =>
          state.sessionId === input.sessionId &&
          state.projectDir === selftestProject,
      );
    if (!isSelftestSession || selftestProject === null) {
      return null;
    }
    const lastCall = selftestProcess(marks, selftestProject, false)?.calls.at(
      -1,
    );
    const followsCold =
      lastCall?.method === 'send' && lastCall.text === FAKE_COLD_TEXT;
    if (!followsCold) {
      return null;
    }
    harnesses.find(isFakeAgentHarness)?.holdCompactions();
    return { action: 'compact', reason: FIXTURE_HOLD_REASON };
  });

  async function makeProjects(): Promise<SelfTestProjects> {
    const home = await files.realPath(deps.homeDir);
    const madeProjects = {
      selftest: path.join(home, SELFTEST_PROJECT_NAME),
      second: path.join(home, SECOND_PROJECT_NAME),
      images: path.join(home, IMAGES_PROJECT_NAME),
    };
    await files.makeFolder(madeProjects.selftest);
    await files.makeFolder(madeProjects.second);
    await files.makeFolder(madeProjects.images);
    selftestProject = madeProjects.selftest;
    return madeProjects;
  }

  // Closes every session an earlier run left open in a self-test project.
  function closeEarlierSessions({
    selftest,
    second,
    images,
  }: SelfTestProjects) {
    for (const state of chat.sessions()) {
      if ([selftest, second, images].includes(state.projectDir)) {
        chat.closed(state.sessionId, 'project-closed');
      }
    }
  }

  // Sends a hold turn, queues a message of two images behind it and interrupts,
  // which returns the message to the session's box.
  async function attachImages(sessionId: string) {
    await chat.send(sessionId, { text: FAKE_HOLD_TEXT, images: [] });
    await waitForTurnRunning(sessionId);
    await chat.send(sessionId, { text: '', images: [...FAKE_HISTORY_IMAGES] });
    chat.interrupt(sessionId);
  }

  async function waitForTurnRunning(sessionId: string) {
    const deadline = Date.now() + RUNNING_TIMEOUT_MS;
    const isRunning = () =>
      chat
        .sessions()
        .some(
          (state) =>
            state.sessionId === sessionId &&
            state.running &&
            state.activity !== 'idle',
        );
    while (!isRunning()) {
      if (Date.now() > deadline) {
        throw new Error(`${IMAGES_PROJECT_NAME}'s hold turn never ran`);
      }
      await new Promise((resolve) => setTimeout(resolve, RUNNING_POLL_MS));
    }
  }

  async function openSessions(
    run: number,
    { selftest, second, images }: SelfTestProjects,
  ): Promise<ChatSelfTestResult> {
    chat.start({ projectDir: second, profile: 'work' });
    const imagesId = chat.start({ projectDir: images, profile: 'work' });
    const id = chat.start({ projectDir: selftest, profile: 'work' });
    await attachImages(imagesId);
    sessions.activate(id);
    const process = selftestProcess(marks, selftest, false);
    const permission = askFixturePermission(chat, id, selftest, {
      toolName: 'Bash',
      input: PERMISSION_INPUT,
      toolUseId: 'selftest-tool-use',
    });
    return permission.then(async (reply): Promise<ChatSelfTestResult> => {
      if (process === null) {
        return { selftest, permission: reply, round: null };
      }
      const relay = sessions.connect({
        sessionId: process.request.sessionId,
        projectDir: selftest,
        harness: 'claude',
      });
      previousRelay = relay;
      const round = await relay.call(
        'ask_round',
        chatRound(run),
        toolCallContext(),
      );
      return { selftest, permission: reply, round };
    });
  }

  function runProblems(result: ChatSelfTestResult): string[] {
    const { selftest } = result;
    return [
      ...fixtureProblems(
        result,
        selftestProcess(marks, selftest, false),
        selftest,
      ),
      ...resumedProblems(selftestProcess(marks, selftest, true), selftest),
      ...pastSessionProblems(marks, selftest),
    ];
  }

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      marks = markRun(harnesses);
      for (const mark of marks) {
        mark.harness.askPermissionsWith(fakePermissionAsk(chat));
      }
      previousRelay?.end();
      const failures: string[] = [];
      archiveResetFailures = failures;
      for (const past of FAKE_PAST_SESSIONS) {
        chat.setArchived(past.sessionId, false).catch((error: unknown) => {
          failures.push(`archive reset failed: ${errorText(error)}`);
        });
      }
      made ??= makeProjects().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then((madeProjects) => {
        closeEarlierSessions(madeProjects);
        return openSessions(run, madeProjects);
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        result,
      };
    },
    groups: GROUPS,
    problems: (result) => {
      harnesses.find(isFakeAgentHarness)?.releaseCompactions();
      return [
        ...archiveResetFailures,
        ...runProblems(result as ChatSelfTestResult),
      ];
    },
  };
}
