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
import { type DocsFixtureOptions, writeDocsFixture } from './selftest-fixture';

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

// Filters only one rule's path matches: `neat` and `style` alone fuzzily match
// other docs' paths too.
const NEAT_RULE_FILTER = 'rulesneat';
const STYLE_RULE_FILTER = 'rulesstyle';

// A filter matching nothing, with no break in it, wider than the session
// split's narrowest tree pane.
const UNMATCHED_FILTER = 'zqzq'.repeat(10);

function docsGroups(paths: Paths, homeDir: string): SelfTestGroup[] {
  // A path below the home as the page shows it.
  const shown = (relative: string) =>
    paths.tilde(paths.join(homeDir, relative), homeDir);
  const docEditor: SelfTestStep[] = [
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] showed Docs mode',
      checksFit: true,
    },
    {
      keys: ['R'],
      expect: '[docs] machine index rebuilt: 16 entries',
      why: "Docs mode's first show built the index during an earlier plugin's steps, before this script rewrote the fixture.",
    },
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
    { keys: ['R'], expect: '[docs] machine index rebuilt: 17 entries' },
  ];
  const treeFilter: SelfTestStep[] = [
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
      why: "Global's first child, Instructions, holds no match, so Enter steps into Rules, the first child the filter shows.",
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
      keys: [...Array<string>(6).fill('j'), 's'],
      expect: '[docs] starred neat.md',
      why: 'Global, Instructions, CLAUDE.md, Rules, Style, then neat.md.',
    },
    { keys: ['g', 'g'], expect: '[docs] selected Starred' },
    { keys: ['h'], expect: '[docs] collapsed Starred' },
    {
      keys: [...Array<string>(7).fill('j'), 'r'],
      expect: '[docs] rename: type the new path',
      why: "Below the collapsed Starred row, neat.md's usual row is seven rows down.",
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
      keys: ['g', 'g', 'j', 'j', 'j', 'j', 'h'],
      expect: '[docs] collapsed Rules',
      why: 'Mine, Global, Instructions, CLAUDE.md, then Rules; h collapses it, where detail views starts.',
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
      name: 'doc editor',
      why: "Docs mode shows and opens CLAUDE.md from a fresh index; the tree scrolls the doc beside it, and Enter on its row focuses the doc. The doc and its editor scroll by lines and half pages, the editor's cursor and a visual selection following the scroll, and Esc in normal mode closes the editor.",
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
      why: '/ filters the tree and Enter keeps the filter: Enter steps into the first child it shows, a trash asked on a match is kept by n or Esc, a filter matching nothing says so, and / Esc clear it; h goes up and collapses.',
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
// table's box and the editor scroll themselves; and Sessions mode's row status
// ends in an ellipsis.
const SCROLLS_ITSELF = [
  '.docs-path',
  '.docs-status',
  '.docs-filtered',
  '.docs-frontmatter-box',
  '.docs-editor',
  '.session-row-status',
];

// Rewrites the fixture under `homeDir` with `options` and opens a session in
// the background with host id `sessionId` in the fixture's repo, then
// activates its row, which shows its only tab, the Docs tab. A failed
// activation ends the session it opened.
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
      deadlineSeconds: null,
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

// Each run ends the previous run's docs session and opens a fresh one over a
// rewritten fixture. The result is null once that chain has run, else the
// error it failed with.
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
      const result = (async (): Promise<string | null> => {
        try {
          previous = await openDocsFixtureSession(
            files,
            homeDir,
            sessions,
            `docs-selftest-${run}`,
            paths,
          );
          return null;
        } catch (error) {
          return errorText(error);
        }
      })();
      return { shownLine: '[sessions] activated selftest-repo', result };
    },
    groups: docsGroups(paths, homeDir),
    problems: (result) =>
      result === null ? [] : [`fixture not ready: ${String(result)}`],
  };
}
