import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import {
  type DocsFixtureOptions,
  WIKI_GUIDE_FILE,
  WIKI_GUIDE_TEXT,
  WIKI_MAIN_FILE,
  WIKI_MAIN_TEXT,
  writeDocsFixture,
} from './selftest-fixture';

export interface DocsSelfTestDeps {
  files: Files;
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  paths: Paths;
}

// The fixture's style rule, relative to the temp home, and the texts the steps
// write over it from outside the app.
const STYLE_RULE_FILE = '.claude/rules/style.md';
const STYLE_RELOADED = '# Style\n\nWrite short lines.\nChanged on disk.\n';
const STYLE_CHANGED_WHILE_EDITING =
  '# Style\n\nWrite short lines.\nChanged while editing.\n';

// Filters only one rule's path holds.
const NEAT_RULE_FILTER = 'neat.md';
const STYLE_RULE_FILTER = 'style.md';

// A filter matching nothing, with no break in it, wider than the session
// split's narrowest tree pane.
const UNMATCHED_FILTER = 'zqzq'.repeat(10);

const RELOADED_MAIN = /^\[docs\] reloaded Main\.md$/;
const ONE_RECENT_COMMIT = /^\[docs\] recent changes: 1 commits$/;
const DOC_FOCUSED = /^\[docs\] doc focused$/;

// The section write's wait, and how often it reads the file.
const SECTION_WRITE_TIMEOUT_MS = 120_000;
const SECTION_WRITE_POLL_MS = 100;

function docsGroups(paths: Paths, homeDir: string): SelfTestGroup[] {
  // A path below the home as the page shows it.
  const shown = (relative: string) =>
    paths.tilde(paths.join(homeDir, relative), homeDir);
  const wikiStart: SelfTestStep[] = [
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] showed Docs mode',
      checksFit: true,
    },
    {
      keys: ['R'],
      expect: '[docs] machine index rebuilt: 19 entries',
      why: "Docs mode's first show built the index during an earlier plugin's steps, before this script rewrote the fixture.",
    },
    {
      keys: ['g', 'h'],
      expect: '[docs] Main page ready',
      why: 'gh in docs.tree. Main.md shows after this line, whether the first show landed first (the page already shows) or gh opened it.',
    },
    {
      keys: ['<C-k>'],
      expect: '[docs] Main.md did not scroll up',
      why: 'The scroll key opens nothing. Step 3 made Main.md the shown doc, so its name is in the line.',
    },
    { keys: ['G'], expect: '[docs] selected Vendor docs' },
    {
      keys: ['g', 'g'],
      expect: '[docs] selected Shelf one',
      checksFit: true,
      screenshot: 'wiki-main',
      why: 'The screenshot shows the title first, Recent changes under the body and the shelves.',
    },
    {
      writeFile: {
        path: WIKI_MAIN_FILE,
        text: `${WIKI_MAIN_TEXT}\n## Shelf three\n\n- [Late page](late.md)\n`,
      },
      keys: [],
      expect: '[docs] read Main.md: 3 shelves',
      alsoExpect: [RELOADED_MAIN],
    },
    { keys: ['G'], expect: '[docs] selected Late page' },
    {
      writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT },
      keys: [],
      expect: '[docs] read Main.md: 2 shelves',
      alsoExpect: [RELOADED_MAIN],
      why: 'The selected row went, so the first row is selected.',
    },
  ];
  const wikiSidebar: SelfTestStep[] = [
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows All pages' },
    { keys: ['g', 'g'], expect: '[docs] selected Mine' },
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows the wiki' },
    { keys: ['g', 'g'], expect: '[docs] selected Shelf one' },
    { keys: ['l'], expect: '[docs] selected Label one' },
    { keys: ['j', 's'], expect: '[docs] stars stay in All pages' },
    { keys: ['l'], expect: '[docs] opened guide.md' },
    {
      keys: ['j', 'j', 'l'],
      expect: '[docs] refused Gone page: not in the index',
      why: 'Guide page, Commit page, then Gone page.',
    },
    {
      keys: ['G', 'k', 'l'],
      expect: '[docs] sidebar shows All pages',
      why: 'wiki:all switches the view.',
    },
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows the wiki' },
  ];
  const wikiSectionEditor: SelfTestStep[] = [
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['<C-l>'], expect: '[docs] section Opening notes' },
    { keys: ['<C-l>'], expect: '[docs] section Middle notes' },
    { keys: ['<C-l>'], expect: '[docs] section Closing notes' },
    { keys: ['<C-l>'], expect: '[docs] no next section' },
    { keys: ['<C-h>'], expect: '[docs] section Middle notes' },
    {
      keys: ['e'],
      expect: '[docs] editing section Middle notes in guide.md',
      checksFit: true,
      screenshot: 'section-editor',
    },
    { keys: ['<C-l>'], expect: '[docs] not moved: the editor is open' },
    {
      keys: ['o', ...'added', 'Escape', ':', 'w', 'Enter'],
      expect: '[docs] wrote guide.md',
      why: 'The result checks the file.',
    },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on guide.md',
    },
  ];
  const wikiLinksAndHistory: SelfTestStep[] = [
    {
      keys: ['<A-h>', '<A-l>'],
      expect: '[docs] doc focused',
      screenshot: 'section-links',
      why: "Focus on the pane starts Tab at the doc's first link.",
    },
    {
      keys: ['Tab', 'Enter'],
      expect: '[docs] opened target.md',
      alsoExpect: [DOC_FOCUSED],
      why: 'The backticks split the reference across a code element and a text node, so this fails if the DOM walk or the wrap fails.',
    },
    { keys: ['<C-o>'], expect: '[docs] opened guide.md' },
    { keys: ['<C-i>'], expect: '[docs] opened target.md' },
    { keys: ['<C-o>'], expect: '[docs] opened guide.md' },
    { keys: ['<A-h>', '<A-l>'], expect: '[docs] doc focused' },
    {
      keys: ['Tab', 'Tab', 'Enter'],
      expect: '[docs] moved within guide.md to line 11',
      why: 'A same-file § link moves and reads nothing.',
    },
    {
      keys: ['<C-i>'],
      expect: '[docs] no later place',
      why: 'The move dropped the forward places.',
    },
    {
      keys: ['g', 'h'],
      expect: '[docs] opened the Main page',
      alsoExpect: [ONE_RECENT_COMMIT],
      why: "gh in docs.doc; the count is the fixture's one commit of plan.md.",
    },
    { keys: ['<A-h>', '<A-l>'], expect: '[docs] doc focused' },
    {
      keys: ['Tab', 'Tab', 'Enter'],
      expect: '[docs] opened SKILL.md',
      alsoExpect: [DOC_FOCUSED],
      why: "The page's second link is a wigley: link, which opens the skill's doc as its sidebar row does.",
    },
    { keys: ['<C-o>'], expect: '[docs] opened Main.md' },
    { keys: ['<A-h>', '<A-l>'], expect: '[docs] doc focused' },
    {
      keys: ['Tab', 'Tab', 'Tab', 'Enter'],
      expect: '[docs] sidebar shows All pages',
      why: "The page's third link is wiki:all, which switches the sidebar and leaves the page shown.",
    },
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows the wiki' },
    { keys: ['<A-h>', '<A-l>'], expect: '[docs] doc focused' },
    {
      keys: ['Tab', 'Enter'],
      expect: '[docs] listed Fixture guides: 2 docs',
      alsoExpect: [DOC_FOCUSED],
      why: "Enter on a focused link is the link's click, and the page's first link is a wiki: list.",
    },
  ];
  const wikiListPages: SelfTestStep[] = [
    {
      keys: ['j', 'l'],
      expect: '[docs] opened target.md',
      why: 'Fixture target is the second row.',
    },
    {
      keys: ['<C-o>'],
      expect: '[docs] listed Fixture guides: 2 docs',
      checksFit: true,
      screenshot: 'list-page',
    },
    {
      keys: ['Enter'],
      expect: '[docs] opened target.md',
      why: 'The cursor stayed on the row opened.',
    },
    { keys: ['<C-o>'], expect: '[docs] listed Fixture guides: 2 docs' },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['g', 'g', ...Array<string>(5).fill('j'), 'l'],
      expect: '[docs] listed Fixture guides: 2 docs',
      why: "l on the sidebar's row lists it and stays in the tree.",
    },
    {
      keys: ['G', 'Enter'],
      expect: '[docs] listed Vendor docs: 2 docs',
      alsoExpect: [DOC_FOCUSED],
    },
    {
      keys: ['l'],
      expect: '[docs] opened SKILL.md',
      why: 'synced-demo is the first row.',
    },
    {
      keys: ['i'],
      expect: '[docs] refused to edit SKILL.md, a downloaded copy',
    },
  ];
  const wikiFromSessionTab: SelfTestStep[] = [
    { keys: [' ', 'k', 's'], expect: '[docs] Docs tab shown' },
    {
      keys: [' ', 'v', 'w'],
      expect: '[docs] a session tab keeps its own tree',
    },
    {
      keys: ['g', 'h'],
      expect: '[docs] opened the Main page',
      alsoExpect: [
        /^\[page\] (showed Docs mode|marked Docs in the activity bar)$/,
        ONE_RECENT_COMMIT,
      ],
    },
  ];
  const wikiNarrowWindow: SelfTestStep[] = [
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    { keys: ['g', 'g', 'j', 'j', 'l'], expect: '[docs] opened guide.md' },
    { width: 1600, keys: ['<A-l>'], expect: '[docs] doc focused' },
    {
      width: 800,
      keys: [],
      expect: '[docs] right column out of sight',
      checksFit: 'held',
      screenshot: 'aside-narrow',
      why: "800 is above the side bar's 680 and leaves .docs-doc under 950.",
    },
    {
      width: 1600,
      keys: [],
      expect: '[docs] right column in sight',
      screenshot: 'aside-wide',
    },
    { width: 'start', keys: ['<A-h>'], expect: '[docs] tree focused' },
  ];
  const wikiWithNoMain: SelfTestStep[] = [
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows All pages' },
    {
      keys: ['/', ...'Main.md', 'Enter'],
      expect: '[docs] filtered the tree: Main.md',
    },
    {
      keys: ['g', 'g', 'Enter', 'Enter', 'Enter'],
      expect: '[docs] selected Fixture main page',
      why: 'Mine, Global, References, then the page.',
    },
    { keys: ['d'], expect: '[docs] asked to move Main.md to the Trash' },
    {
      keys: ['y'],
      expect: '[docs] moved Main.md to the Trash',
      alsoExpect: [/^\[docs\] no Main\.md: /],
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows the wiki' },
    {
      keys: ['g', 'h'],
      expect: '[docs] showed the empty Main page',
      alsoExpect: [DOC_FOCUSED],
      checksFit: true,
      screenshot: 'main-empty',
      why: 'The doc pane showed guide.md, so the step also proves the empty page replaces a doc. It takes focus, so the screenshot shows the create it hint beside the ~ path and No pages in Main.md.',
    },
    {
      keys: ['<A-l>'],
      expect: '[page] no pane right',
      why: 'gh moved focus to the doc pane, the rightmost.',
    },
    {
      keys: ['i'],
      expect: '[docs] created Main.md',
      alsoExpect: [
        /^\[docs\] read Main\.md: 0 shelves$/,
        /^\[docs\] editing Main\.md$/,
      ],
    },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on Main.md',
    },
    {
      writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT },
      keys: [],
      expect: '[docs] read Main.md: 2 shelves',
      alsoExpect: [RELOADED_MAIN],
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['R'],
      expect: '[docs] machine index rebuilt: 19 entries',
      why: "The stand-in lists the fixture's entry again, with its title.",
    },
    { keys: [' ', 'v', 'w'], expect: '[docs] sidebar shows All pages' },
    {
      keys: ['/', ...'Main.md', 'Enter'],
      expect: '[docs] filtered the tree: Main.md',
    },
    {
      keys: ['g', 'g', 'Enter', 'Enter', 'Enter'],
      expect: '[docs] selected Fixture main page',
    },
    { keys: ['d'], expect: '[docs] asked to move Main.md to the Trash' },
    {
      keys: ['y'],
      expect: '[docs] showed the empty Main page',
      alsoExpect: [
        /^\[docs\] moved Main\.md to the Trash$/,
        /^\[docs\] no Main\.md: the file is absent$/,
      ],
      why: "Main.md is the doc shown. Whichever of the trash and the read lands first, the read's change shows the empty page.",
    },
    {
      writeFile: { path: WIKI_MAIN_FILE, text: WIKI_MAIN_TEXT },
      keys: [],
      expect: '[docs] opened the Main page',
      alsoExpect: [/^\[docs\] read Main\.md: 2 shelves$/],
      why: 'The file that appeared replaces the empty page.',
    },
    {
      keys: ['R'],
      expect: '[docs] machine index rebuilt: 19 entries',
      why: "The stand-in lists the fixture's entry again, with its title.",
    },
    {
      keys: ['g', 'g', 'Enter', 'Enter', 'Enter'],
      expect: '[docs] selected Fixture main page',
      why: 'The filter stays through the trash, and the collapses below start from the page.',
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    {
      keys: ['h', 'h'],
      expect: '[docs] collapsed References',
      why: "The filter's end expanded References. The later groups count rows with it collapsed, as tree filter's end does for Rules.",
    },
    {
      keys: ['G', 'h', 'h', 'h', 'h'],
      expect: '[docs] collapsed wigley@vendor-market',
      why: "The wigley: link selected its skill, which expanded the plugin's groups. h steps up from the skill and collapses Skills and the plugin, so the row above the last row is the synced skill again.",
    },
    {
      keys: ['G', 'k', ...Array<string>(6).fill('h')],
      expect: '[docs] collapsed Third-party',
      why: "The list page's row selected its skill, which expanded Third-party. h steps up from the skill and collapses each group on the way, as ownership's end does: ownership expects them collapsed.",
    },
  ];
  const docEditor: SelfTestStep[] = [
    { keys: ['G'], expect: '[docs] selected Third-party' },
    { keys: ['g', 'g'], expect: '[docs] selected Mine' },
    {
      keys: ['j', 'j', 'l'],
      expect: '[docs] expanded Instructions',
      why: "Mine's first child is Global, expanded, whose first child is Instructions.",
    },
    { keys: ['j', 'l'], expect: '[docs] opened CLAUDE.md', checksFit: true },
    {
      keys: ['<C-j>'],
      expect: '[docs] scrolled CLAUDE.md down a line',
      why: 'The tree takes the scroll keys and scrolls the doc beside it.',
    },
    {
      keys: ['<C-S-j>'],
      expect: '[docs] scrolled CLAUDE.md down half a page',
    },
    { keys: ['<C-S-k>'], expect: '[docs] scrolled CLAUDE.md up half a page' },
    {
      keys: ['<C-k>'],
      expect: '[docs] scrolled CLAUDE.md up a line to the top',
    },
    {
      keys: ['k', 'j'],
      expect: '[page] j ran docs.treeDown',
      why: 'Scrolling the doc from the tree leaves focus in the tree.',
    },
    {
      keys: ['Enter'],
      expect: '[docs] doc focused',
      why: 'Enter on a doc row opens it and focuses the doc.',
    },
    { keys: ['<C-j>'], expect: '[docs] scrolled CLAUDE.md down a line' },
    {
      keys: ['<C-S-j>'],
      expect: '[docs] scrolled CLAUDE.md down half a page',
    },
    { keys: ['<C-S-k>'], expect: '[docs] scrolled CLAUDE.md up half a page' },
    {
      keys: ['<C-k>'],
      expect: '[docs] scrolled CLAUDE.md up a line to the top',
    },
    { keys: ['i'], expect: '[docs] editing CLAUDE.md' },
    {
      keys: ['<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down a line, line 2 at the top; the cursor moved',
      why: 'A line scroll leaves the first line, and the cursor on it, wholly out of sight.',
    },
    {
      keys: ['<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down a line, line 3 at the top; the cursor moved',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up a line, line 2 at the top; the cursor stayed',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up a line to the top, line 1 at the top; the cursor stayed',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] the editor on CLAUDE.md did not scroll up; the cursor stayed',
    },
    {
      keys: ['<C-S-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down half a page; the cursor moved',
    },
    {
      keys: ['<C-S-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page to the top; the cursor stayed',
    },
    {
      keys: ['G', '<C-S-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page; the cursor moved',
    },
    {
      keys: ['g', 'g', 'V', '<C-S-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down half a page; the cursor moved',
    },
    {
      keys: ['<C-S-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page to the top; the cursor moved',
    },
    {
      keys: ['<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down a line, line 2 at the top; the cursor moved',
      why: "In visual mode the cursor a line scroll leaves out of sight moves down, growing the selection, and vim's motion leaves no sliver of the first line in sight.",
    },
    {
      keys: ['<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down a line, line 3 at the top; the cursor moved',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up a line, line 2 at the top; the cursor stayed',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up a line to the top, line 1 at the top; the cursor stayed',
    },
    {
      keys: ['Escape', 'g', 'g', '<C-k>'],
      expect:
        '[docs] the editor on CLAUDE.md did not scroll up; the cursor stayed',
      why: 'Esc in visual mode returns to normal mode and leaves the editor open.',
    },
    {
      keys: ['i', 'Escape', '<C-k>'],
      expect:
        '[docs] the editor on CLAUDE.md did not scroll up; the cursor stayed',
      why: 'Esc in insert mode returns to normal mode and leaves the editor open.',
    },
    {
      keys: ['d', 'Escape', '<C-k>'],
      expect:
        '[docs] the editor on CLAUDE.md did not scroll up; the cursor stayed',
      why: 'Esc after an unfinished d cancels the d and leaves the editor open.',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['Enter'],
      expect: '[docs] doc focused',
      why: 'Enter on the row of the doc in the editor focuses the editor.',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] the editor on CLAUDE.md did not scroll up; the cursor stayed',
      why: 'Enter on the shown doc keeps its editor open rather than reopening the doc.',
    },
    {
      keys: ['Escape'],
      expect: '[docs] closed the editor on CLAUDE.md',
      why: 'Esc in normal mode closes the editor as :q does.',
    },
  ];
  const linksAndDiskChanges: SelfTestStep[] = [
    { keys: ['Tab', 'Enter'], expect: '[docs] opened style.md' },
    {
      writeFile: { path: STYLE_RULE_FILE, text: STYLE_RELOADED },
      keys: [],
      expect: '[docs] reloaded style.md',
    },
    { keys: ['i'], expect: '[docs] editing style.md', checksFit: true },
    {
      writeFile: { path: STYLE_RULE_FILE, text: STYLE_CHANGED_WHILE_EDITING },
      keys: [],
      expect: '[docs] changed on disk: style.md',
    },
    // Each :w below meets a disk that differs from the text the editor last
    // read or wrote, so it shows the changed-on-disk prompt. The prompt's key
    // goes in a step of its own, after the prompt's line.
    {
      keys: ['o', ...'mine', 'Escape', ':', 'w', 'Enter'],
      expect: '[docs] changed on disk, not written: style.md',
    },
    { keys: ['r'], expect: '[docs] reloaded style.md' },
    {
      writeFile: { path: STYLE_RULE_FILE, text: STYLE_RELOADED },
      keys: ['o', ...'mine', 'Escape', ':', 'w', 'Enter'],
      expect: '[docs] changed on disk, not written: style.md',
    },
    { keys: ['o'], expect: '[docs] wrote style.md' },
    {
      writeFile: { path: STYLE_RULE_FILE, text: STYLE_CHANGED_WHILE_EDITING },
      keys: ['o', ...'mine', 'Escape', ':', 'w', 'Enter'],
      expect: '[docs] changed on disk, not written: style.md',
    },
    { keys: ['Escape'], expect: '[docs] kept editing style.md' },
    {
      keys: [':', 'w', 'Enter'],
      expect: '[docs] changed on disk, not written: style.md',
    },
    { keys: ['o'], expect: '[docs] wrote style.md' },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on style.md',
    },
    { keys: ['i'], expect: '[docs] editing style.md' },
    {
      keys: ['x', ':', 'q', 'Enter'],
      expect:
        '[docs] refused to close the editor with unsaved edits on style.md',
    },
    {
      keys: ['Escape'],
      expect:
        '[docs] refused to close the editor with unsaved edits on style.md',
      why: 'Esc in normal mode refuses as :q does while the editor holds unsaved edits.',
    },
    {
      keys: [':', 'q', '!', 'Enter'],
      expect: '[docs] dropped edits on style.md',
    },
  ];
  const createAndRename: SelfTestStep[] = [
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['a'],
      expect: '[docs] create: pick a kind',
      checksFit: true,
      screenshot: 'kind-picker',
    },
    { keys: ['j', 'Enter'], expect: '[docs] create rule: pick a place' },
    { keys: ['Enter'], expect: '[docs] create rule: name it' },
    { keys: [...'tidy', 'Enter'], expect: '[docs] created tidy.md' },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on tidy.md',
    },
    {
      keys: ['Escape'],
      expect: '[docs] tree focused',
      why: 'Esc on the rendered doc returns focus to the tree.',
    },
    {
      keys: ['r'],
      expect: '[docs] rename: type the new path',
      checksFit: true,
    },
    {
      keys: [...Array<string>(7).fill('Backspace'), ...'neat.md', 'Enter'],
      expect: '[docs] renamed tidy.md to neat.md',
    },
    { keys: ['A'], expect: '[docs] create by path: type the path' },
    {
      keys: ['n', 'Tab'],
      expect: `[docs] completed to ${shown('.claude/rules/neat.md')}`,
      checksFit: true,
      screenshot: 'completion',
    },
    { keys: ['Escape'], expect: '[docs] create cancelled' },
    { keys: ['A'], expect: '[docs] create by path: type the path' },
    { keys: [...'fresh.md', 'Enter'], expect: '[docs] created fresh.md' },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on fresh.md',
    },
  ];
  const trashAndRescan: SelfTestStep[] = [
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['d'],
      expect: '[docs] asked to move fresh.md to the Trash',
      checksFit: true,
    },
    { keys: ['y'], expect: '[docs] moved fresh.md to the Trash' },
    { keys: ['R'], expect: '[docs] machine index rebuilt: 20 entries' },
  ];
  const treeFilter: SelfTestStep[] = [
    {
      keys: ['/', ...'Long section', 'Enter'],
      expect: '[docs] filtered the tree: Long section',
    },
    { keys: ['g', 'g'], expect: '[docs] selected Mine' },
    {
      keys: ['Enter', 'Enter', 'Enter'],
      expect: '[docs] selected Self-test instructions',
      why: 'Under the filter Enter steps from Mine to Global, Instructions, then the doc holding the heading.',
    },
    {
      keys: ['j', 'Enter'],
      expect: '[docs] opened CLAUDE.md',
      alsoExpect: [DOC_FOCUSED],
      why: 'The row under the doc is its heading.',
    },
    {
      keys: ['<C-h>'],
      expect: '[docs] section Second heading',
      why: "The section before the one in sight, so the row opened the doc at Long section's line and not at its top.",
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    {
      keys: ['/', ...NEAT_RULE_FILTER, 'Enter'],
      expect: `[docs] filtered the tree: ${NEAT_RULE_FILTER}`,
    },
    { keys: ['g', 'g'], expect: '[docs] selected Mine' },
    {
      keys: ['Enter'],
      expect: '[docs] selected Global',
      why: "Under a filter Enter steps into Mine's first shown child.",
    },
    {
      keys: ['Enter'],
      expect: '[docs] selected Rules',
      why: "Global's first children hold no match, so Enter steps into Rules, the first child the filter shows.",
    },
    { keys: ['Enter'], expect: '[docs] selected neat.md' },
    {
      keys: ['k', 'k', 'j', 'j', 'd'],
      expect: '[docs] asked to move neat.md to the Trash',
    },
    { keys: ['n'], expect: '[docs] kept neat.md' },
    { keys: ['d'], expect: '[docs] asked to move neat.md to the Trash' },
    { keys: ['Escape'], expect: '[docs] kept neat.md' },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    {
      keys: ['/', ...'zqzq', 'Enter'],
      expect: '[docs] no docs match "zqzq"',
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    { keys: ['h', 'h'], expect: '[docs] collapsed Rules' },
  ];
  const recencyAndStars: SelfTestStep[] = [
    { keys: ['l'], expect: '[docs] expanded Rules' },
    {
      keys: ['l'],
      expect: '[docs] selected Style',
      why: 'Style was loaded and neat.md never was, so Style leads Rules though neat.md comes first by title.',
    },
    {
      keys: ['s'],
      expect: '[docs] starred Style',
      checksFit: true,
      screenshot: 'starred',
      why: "The screenshot shows the star on both Style rows and Style's time at its row's end.",
    },
    {
      keys: ['g', 'g'],
      expect: '[docs] selected Starred',
      why: 'The Starred group shows above Mine.',
    },
    {
      keys: ['l'],
      expect: '[docs] selected Style',
      why: 'A Starred group that first shows starts expanded, and it holds Style.',
    },
    {
      keys: ['s'],
      expect: '[docs] unstarred Style',
      why: "Unstarring from Starred's Style removes its row, and the cursor moves to Style's usual row.",
    },
    {
      keys: ['l'],
      expect: '[docs] opened style.md',
      why: "Starred's Style row is gone, so the cursor sits on Style's usual row, which l opens.",
    },
    {
      keys: ['s'],
      expect: '[docs] starred Style',
      why: 'Starring it again from its usual row brings back the Starred group.',
    },
    {
      keys: ['s'],
      expect: '[docs] unstarred Style',
      why: 'The cursor stays on the usual row, where s unstars it.',
    },
    {
      keys: ['g', 'g'],
      expect: '[docs] selected Mine',
      why: 'Unstarring the only starred doc removes the Starred group.',
    },
    {
      keys: [...Array<string>(7).fill('j'), 's'],
      expect: '[docs] starred neat.md',
      why: 'Global, Instructions, CLAUDE.md, References, Rules, Style, then neat.md.',
    },
    { keys: ['g', 'g'], expect: '[docs] selected Starred' },
    { keys: ['h'], expect: '[docs] collapsed Starred' },
    {
      keys: [...Array<string>(8).fill('j'), 'r'],
      expect: '[docs] rename: type the new path',
      why: "Below the collapsed Starred row, neat.md's usual row is eight rows down.",
    },
    {
      keys: [...Array<string>(7).fill('Backspace'), ...'tidy.md', 'Enter'],
      expect: '[docs] renamed neat.md to tidy.md',
    },
    { keys: ['g', 'g'], expect: '[docs] selected Starred' },
    {
      keys: ['l'],
      expect: '[docs] expanded Starred',
      why: 'Renaming the starred doc keeps the Starred group collapsed.',
    },
    { keys: ['l'], expect: '[docs] selected tidy.md' },
    {
      keys: ['s', 'r'],
      expect: '[docs] rename: type the new path',
      why: "Unstarring from Starred's row moves the cursor to tidy.md's usual row, which r renames.",
    },
    {
      keys: [...Array<string>(7).fill('Backspace'), ...'neat.md', 'Enter'],
      expect: '[docs] renamed tidy.md to neat.md',
    },
    {
      keys: ['g', 'g', 'j', 'j', 'j', 'j', 'j', 'h'],
      expect: '[docs] collapsed Rules',
      why: 'Mine, Global, Instructions, CLAUDE.md, References, then Rules; h collapses it, where detail views starts.',
    },
  ];
  const detailViews: SelfTestStep[] = [
    { keys: ['j', 'l'], expect: '[docs] expanded Hooks' },
    { keys: ['j', 'l'], expect: '[docs] opened settings.json' },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['i'], expect: '[docs] editing settings.json' },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on settings.json',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['j', 'j', 'l'],
      expect: '[docs] expanded selftest-plugin@selftest-market',
    },
    { keys: ['j', 'j', 'l'], expect: '[docs] expanded Plugins' },
    { keys: ['j', 'l'], expect: '[docs] opened 1.0.0' },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['i'], expect: '[docs] editing installed_plugins.json' },
    {
      keys: [':', 'q', 'Enter'],
      expect: '[docs] closed the editor on installed_plugins.json',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
  ];
  const pluginCache: SelfTestStep[] = [
    { keys: ['k', 'k', 'l'], expect: '[docs] expanded Skills' },
    { keys: ['j', 'l'], expect: '[docs] opened SKILL.md' },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['j'], expect: '[page] j ran docs.scrollDown' },
    { keys: ['k'], expect: '[page] k ran docs.scrollUp' },
    { keys: ['<C-j>'], expect: '[docs] SKILL.md did not scroll down' },
    { keys: ['<C-k>'], expect: '[docs] SKILL.md did not scroll up' },
    { keys: ['<C-S-j>'], expect: '[docs] SKILL.md did not scroll down' },
    { keys: ['<C-S-k>'], expect: '[docs] SKILL.md did not scroll up' },
    {
      keys: ['i'],
      expect: '[docs] refused to edit SKILL.md in the plugin cache',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
  ];
  const ownership: SelfTestStep[] = [
    {
      keys: ['G'],
      expect: '[docs] selected Third-party',
      why: "Third-party is the tree's last row.",
    },
    {
      keys: ['l'],
      expect: '[docs] expanded Third-party',
      why: 'l expands only a collapsed group, so Third-party was collapsed.',
    },
    {
      keys: ['l'],
      expect: '[docs] selected Synced skills',
      why: "Synced skills is Third-party's first node.",
    },
    { keys: ['l'], expect: '[docs] expanded Synced skills' },
    { keys: ['j', 'l'], expect: '[docs] expanded Skills' },
    {
      keys: ['j', 'l'],
      expect: '[docs] opened SKILL.md',
      checksFit: true,
      screenshot: 'third-party',
    },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    {
      keys: ['i'],
      expect: '[docs] refused to edit SKILL.md, a downloaded copy',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['h', 'h', 'h', 'h', 'h', 'h'],
      expect: '[docs] collapsed Third-party',
      why: 'h steps up from the skill and collapses each group on the way: Skills, Synced skills, Third-party.',
    },
  ];
  const pickers: SelfTestStep[] = [
    { keys: ['a'], expect: '[docs] create: pick a kind' },
    { keys: ['j', 'k', 'j', 'l'], expect: '[docs] create rule: pick a place' },
    { keys: ['Escape'], expect: '[docs] create cancelled' },
    { keys: ['c'], expect: '[page] c ran docs.pickContext', checksFit: true },
    {
      keys: [' ', 'v', 't'],
      expect: '[page] side bar hidden',
      why: 'The picker keeps its keys through the side bar hiding under it.',
    },
    {
      keys: ['j', 'Enter'],
      expect: `[docs] context ${shown('dev/selftest-repo')}`,
    },
    { keys: [' ', 'v', 't'], expect: '[page] side bar shown' },
  ];
  const sideBar: SelfTestStep[] = [
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] side bar hidden',
      checksFit: true,
    },
    {
      keys: ['<A-h>'],
      expect: '[page] no pane left',
      why: 'Option+h moves to no pane while the tree is hidden.',
    },
    {
      keys: ['Escape'],
      expect: '[page] side bar shown',
      why: 'Esc on the doc reveals the hidden tree.',
    },
    { keys: [' ', 'k', 'd'], expect: '[page] side bar hidden' },
    { keys: [' ', 'k', 'd'], expect: '[page] side bar shown' },
    { keys: [' ', 'v', 't'], expect: '[page] side bar hidden' },
    { keys: [' ', 'v', 't'], expect: '[page] side bar shown' },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
  ];
  const narrowWindow: SelfTestStep[] = [
    {
      width: 600,
      keys: ['j'],
      expect:
        '[docs] tree out of sight: treeDown ran docs.scrollDown in the doc',
      why: 'Below 680 px the side bar hides, so a tree key runs in the doc pane by the keymap.',
    },
    { width: 'start', keys: ['<A-h>'], expect: '[docs] tree focused' },
  ];
  const sessionDocsTab: SelfTestStep[] = [
    {
      keys: [' ', 'k', 's'],
      expect: '[docs] Docs tab shown',
      checksFit: true,
      screenshot: 'session-tab',
    },
    { keys: ['R'], expect: '[docs] session index read: 4 entries' },
    { keys: [' ', 'v', 't'], expect: '[docs] tree hidden', checksFit: true },
    {
      keys: ['Escape'],
      expect: '[docs] tree shown',
      why: 'Esc on the doc reveals the hidden tree.',
    },
    { keys: [' ', 'v', 't'], expect: '[docs] tree hidden' },
    { keys: [' ', 'v', 't'], expect: '[docs] tree shown' },
    {
      keys: ['<A-h>'],
      expect: '[docs] tree focused',
      why: 'The tree scope comes back for the filter and the kind picker.',
    },
    {
      keys: ['/', ...UNMATCHED_FILTER, 'Enter'],
      expect: `[docs] no docs match "${UNMATCHED_FILTER}"`,
      checksFit: true,
      why: "The session split keeps its tree at the fit check's width, where Docs mode hides its side bar, so the tree's lines are checked here.",
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    {
      keys: ['/', ...'style', 'Enter'],
      expect: '[docs] filtered the tree: style',
      checksFit: true,
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
  ];
  const docsModeFromSession: SelfTestStep[] = [
    { keys: ['a'], expect: '[docs] create: pick a kind' },
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] marked Docs in the activity bar',
      why: 'The picker holds no text box, so Space reaches the leader.',
    },
    {
      keys: ['j'],
      expect: '[page] j ran docs.treeDown',
      why: "Both views' pane scope is tree, so only closing the session view's kind picker on Docs mode's show frees j for Docs mode's tree.",
    },
    {
      keys: ['/', ...NEAT_RULE_FILTER, 'Enter'],
      expect: `[docs] filtered the tree: ${NEAT_RULE_FILTER}`,
    },
    {
      keys: ['j', 'j', 'j', 'j', 'r'],
      expect: '[docs] rename: type the new path',
    },
    {
      keys: [...Array<string>(7).fill('Backspace'), ...'kept.md', 'Enter'],
      expect: '[docs] session index read: 4 entries',
      why: 'The session view has read its index, so the rename runs it again.',
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
  ];
  const starsAcrossViews: SelfTestStep[] = [
    {
      keys: ['/', ...STYLE_RULE_FILTER, 'Enter'],
      expect: `[docs] filtered the tree: ${STYLE_RULE_FILTER}`,
    },
    { keys: ['g', 'g'], expect: '[docs] selected Mine' },
    {
      keys: ['Enter', 'Enter', 'Enter'],
      expect: '[docs] selected Style',
      why: 'Under the filter Enter steps from Mine to Global, Rules, then Style.',
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    { keys: ['s'], expect: '[docs] starred Style' },
    { keys: ['g', 'g'], expect: '[docs] selected Starred' },
    { keys: ['l'], expect: '[docs] selected Style' },
    { keys: [' ', 'k', 's'], expect: '[docs] Docs tab shown' },
    {
      keys: ['g', 'g'],
      expect: '[docs] selected Starred',
      why: "The session view's index lists Style too, so it shows the Starred group.",
    },
    { keys: ['l'], expect: '[docs] selected Style' },
    { keys: ['s'], expect: '[docs] unstarred Style' },
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] marked Docs in the activity bar',
    },
    {
      keys: ['l'],
      expect: '[docs] opened style.md',
      why: "The session view's unstar dropped Docs mode's selected Starred row, so its cursor moved to Style's usual row, which l opens.",
    },
  ];
  const transparency: SelfTestStep[] = [
    { keys: [' ', 'z', 'g'], expect: '[page] showed Gallery mode' },
    { keys: ['t'], expect: '[gallery] transparency reduced' },
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] showed Docs mode',
      screenshot: 'docs-reduced',
    },
    { keys: [' ', 'z', 'g'], expect: '[page] showed Gallery mode' },
    { keys: ['t'], expect: '[gallery] transparency full' },
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] showed Docs mode',
      screenshot: 'docs-full',
    },
  ];
  return [
    {
      name: 'wiki start',
      why: "gh leaves Main.md shown whichever of the first show and gh opened it, and the sidebar's shelves come from the file and follow an outside change to it. No step expects the first show's own lines, since one it logs can come before this script's mark in a whole run.",
      steps: wikiStart,
    },
    {
      name: 'wiki sidebar',
      why: 'Space v w switches between the wiki and All pages, each keeping its own cursor; a page row opens its doc, a dangling row refuses with its toast, a wiki:all row switches the view, and stars stay in All pages.',
      steps: wikiSidebar,
    },
    {
      name: 'wiki section editor',
      why: "Ctrl+l and Ctrl+h move by section and stop at the end; e opens the section in place, the moves refuse while it is open, and :w writes only that section's change, which the result checks on disk.",
      steps: wikiSectionEditor,
    },
    {
      name: 'wiki links and history',
      why: "A § link with backticks and a bare § link each draw as one link in the mounted body, which only this group's steps reach; one opens its target, the other moves in the doc; Ctrl+o and Ctrl+i go back and forward; gh from the doc opens Main with Recent changes; and in the body a wigley: link opens its skill, wiki:all switches the sidebar and a wiki: link opens its list.",
      steps: wikiLinksAndHistory,
    },
    {
      name: 'wiki list pages',
      why: "A list page lists the docs of its link's kind, grouped by repo; j moves its cursor and l or Enter opens the row, Ctrl+o returns with the same row as the cursor, and a third-party list's row opens read-only.",
      steps: wikiListPages,
    },
    {
      name: 'wiki from a session tab',
      why: "Space v w on a session's Docs tab says it keeps its own tree, and gh there shows Docs mode and opens Main.",
      steps: wikiFromSessionTab,
    },
    {
      name: 'wiki narrow window',
      why: "The doc's right column shows at a wide width and hides at a narrow one, with the tree still shown, so the article keeps its width.",
      steps: wikiNarrowWindow,
    },
    {
      name: 'wiki with no Main.md',
      why: 'With Main.md gone the sidebar empties and gh shows the empty Main page with focus on it, i creates the file from the starter text and edits it, and an outside write brings the shelves back. Trashing Main.md while it shows ends on the empty page, and writing it back opens it. The group leaves All pages shown, with References and Third-party collapsed, for the groups after it.',
      steps: wikiWithNoMain,
    },
    {
      name: 'doc editor',
      why: "The tree opens CLAUDE.md and scrolls the doc beside it, and Enter on its row focuses the doc. The doc and its editor scroll by lines and half pages, the editor's cursor and a visual selection following the scroll, and Esc in normal mode closes the editor.",
      steps: docEditor,
    },
    {
      name: 'links and disk changes',
      why: "A doc's link opens its target. A change on disk reloads it, or while editing shows the changed-on-disk banner and a prompt on :w that reloads, overwrites or keeps editing; :q refuses unsaved edits and :q! drops them.",
      steps: linksAndDiskChanges,
    },
    {
      name: 'create and rename',
      why: 'a creates a doc by kind and place and opens it in the editor, r renames it through the path box, and A completes a path with Tab and creates one by path.',
      steps: createAndRename,
    },
    {
      name: 'trash and rescan',
      why: 'd asks to move a doc to the Trash and y does, and R rescans the index to match the disk.',
      steps: trashAndRescan,
    },
    {
      name: 'tree filter',
      why: '/ filters the tree and Enter keeps the filter: a heading row opens its doc at the heading, Enter steps into the first child it shows, a trash asked on a match is kept by n or Esc, a filter matching nothing says so, and / Esc clear it; h goes up and collapses.',
      steps: treeFilter,
    },
    {
      name: 'recency and stars',
      why: 'Rules lists its loaded doc before a never-loaded one that comes first by title; s stars a doc into a Starred group above Mine, shown expanded and starred in both places, and s unstars it from either row and removes the group, an unstar from Starred moving the cursor to its usual row; renaming a starred doc keeps a collapsed Starred group collapsed.',
      steps: recencyAndStars,
    },
    {
      name: 'detail views',
      why: 'A hook and a plugin open as detail views, which i edits as settings.json and installed_plugins.json.',
      steps: detailViews,
    },
    {
      name: 'plugin cache',
      why: "The scroll keys reach a plugin's cached SKILL.md, too short to scroll, and i refuses to edit it in the plugin cache.",
      steps: pluginCache,
    },
    {
      name: 'ownership',
      why: "The tree holds the user's docs under Mine and downloaded copies under Third-party, collapsed until expanded; Synced skills is Third-party's first node, and i refuses to edit a synced skill as a downloaded copy.",
      steps: ownership,
    },
    {
      name: 'pickers',
      why: "The kind picker's place picker cancels on Esc, and the context picker keeps its keys through the side bar hiding under it and picks the repo.",
      steps: pickers,
    },
    {
      name: 'side bar',
      why: "Space k d and Space v t hide and show Docs mode's side bar, hiding it focuses the doc, and Option+h brings it back and focuses the tree.",
      steps: sideBar,
    },
    {
      name: 'narrow window',
      why: 'In a window too narrow for the side bar, a tree key reaches the doc pane instead of moving a selection out of sight, and Option+h focuses the tree once the window is back at its start width.',
      steps: narrowWindow,
    },
    {
      name: 'session Docs tab',
      why: "Space k s shows the docs session's Docs tab over its own session index; Space v t hides and shows its tree, Option+h reveals it, and its filter keeps and clears like Docs mode's.",
      steps: sessionDocsTab,
    },
    {
      name: 'Docs mode from a session',
      why: "Showing Docs mode from a session tab closes that view's kind picker, so tree keys move Docs mode's tree, and a rename there makes the session view read its index again.",
      steps: docsModeFromSession,
    },
    {
      name: 'stars across views',
      why: "A star in Docs mode shows in the session view's Starred group, and an unstar there that drops Docs mode's selected Starred row moves its cursor to the doc's usual row.",
      steps: starsAcrossViews,
    },
    {
      name: 'transparency',
      why: 'Docs mode shows under reduced and full transparency, each set in Gallery mode.',
      steps: transparency,
    },
  ];
}

// Paths, the status line and the filtered line end in an ellipsis; the field
// table's box and the editor scroll themselves.
const SCROLLS_ITSELF = [
  '.docs-path',
  '.docs-status',
  '.docs-filtered',
  '.docs-frontmatter-box',
  '.docs-editor',
];

// Rewrites the fixture under `homeDir` with `options` and opens a session in
// the background with host id `sessionId` in the fixture's repo, then
// activates its row, which shows its only tab, the Docs tab, with
// `docs-session-tab` on (disabled by default; the self-test starts it). A
// failed activation ends the session it opened.
export async function openDocsFixtureSession(
  files: Files,
  homeDir: string,
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>,
  sessionId: string,
  paths: Paths,
  options: DocsFixtureOptions = { loadStates: false },
): Promise<OwnedSession> {
  await writeDocsFixture(files, homeDir, paths, options);
  const home = await files.realPath(homeDir);
  const opened = sessions.open(
    {
      sessionId,
      projectDir: paths.join(home, 'dev', 'selftest-repo'),
      harness: 'claude',
    },
    { select: false },
  );
  try {
    sessions.activate(opened.session.id);
  } catch (error) {
    opened.end();
    throw error;
  }
  return opened;
}

// The problem with the section editor's write, empty when the guide on disk
// differs from the fixture's text only by the line the steps add.
async function followSectionWrite(
  files: Files,
  homeDir: string,
  paths: Paths,
): Promise<string[]> {
  const guide = paths.join(await files.realPath(homeDir), WIKI_GUIDE_FILE);
  const deadline = Date.now() + SECTION_WRITE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await files.read(guide).catch(() => WIKI_GUIDE_TEXT);
    if (text !== WIKI_GUIDE_TEXT) {
      const expected = WIKI_GUIDE_TEXT.replace(
        '## Middle notes\n',
        '## Middle notes\nadded\n',
      );
      return text === expected
        ? []
        : [`guide.md after the section write: ${text}`];
    }
    await new Promise((resolve) => setTimeout(resolve, SECTION_WRITE_POLL_MS));
  }
  return ['guide.md never changed'];
}

// Each run ends the previous run's docs session and opens a fresh one over a
// rewritten fixture. The result lists what was wrong with the fixture or with
// the section editor's write, empty when nothing was.
export function docsSelfTestScript(deps: DocsSelfTestDeps): SelfTestScript {
  const { files, homeDir, sessions, paths } = deps;
  let previous: OwnedSession | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      previous?.end();
      previous = null;
      const result = (async (): Promise<string[]> => {
        try {
          previous = await openDocsFixtureSession(
            files,
            homeDir,
            sessions,
            `docs-selftest-${run}`,
            paths,
          );
        } catch (error) {
          return [`fixture not ready: ${errorText(error)}`];
        }
        return followSectionWrite(files, homeDir, paths);
      })();
      return { shownLine: '[sessions] activated selftest-repo', result };
    },
    groups: docsGroups(paths, homeDir),
    problems: (result) => result as string[],
  };
}
