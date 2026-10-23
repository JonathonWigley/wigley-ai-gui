import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  ConnectedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import { writeDocsFixture } from './selftest-fixture';

export interface DocsSelfTestDeps {
  files: Files;
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
  paths: Paths;
}

// The fixture's style rule, relative to the temp home, and the texts the steps
// write over it from outside the app.
const STYLE_RULE_FILE = '.claude/rules/style.md';
const STYLE_RELOADED = '# Style\n\nWrite short lines.\nChanged on disk.\n';
const STYLE_CHANGED_WHILE_EDITING =
  '# Style\n\nWrite short lines.\nChanged while editing.\n';

// A filter matching nothing, with no break in it, wider than the session
// split's narrowest tree pane.
const UNMATCHED_FILTER = 'zqzq'.repeat(10);

// Space k d shows Docs mode. Its first show built the index during an earlier
// plugin's steps, before this script rewrote the fixture, so R rescans: the
// fixture's eight entries. G selects the last row and gg the first, Global. j
// to Global's Instructions and l expands it; j to the self-test instructions
// and l opens CLAUDE.md. Option+l focuses the doc; Ctrl+j scrolls it half a
// page and Ctrl+k back to the top. i edits it at the top: Ctrl+j scrolls the
// editor half a page, moving the cursor, and Ctrl+k back to the top, where the
// cursor is in sight; G and Ctrl+k scroll up from the bottom, moving the cursor
// into sight. gg, V and Ctrl+j grow the selection with the scroll, and Ctrl+k
// shrinks it back to the top. Esc, and :q closes the editor. Tab reaches the
// doc's first link, the style rule, and Enter follows it. A change on disk
// reloads style.md. i edits it, and a second change on disk shows the
// changed-on-disk banner. o types a new line below, Esc to normal mode and :w
// meets the changed-on-disk prompt, where r reloads the disk's text. Another
// change on disk, a new line and :w again, and o overwrites the disk. A third,
// and Esc keeps editing; :w shows the prompt again and o overwrites. :q closes
// the editor. i again, x deletes a character, so :q is refused and :q! drops
// the edit. Option+h back to the tree; a asks for a kind (the kind picker's
// screenshot), j Enter picks rule, Enter its one place, and tidy names it,
// which creates tidy.md and opens it in the editor; :q closes it. Option+h to
// the tree, where r opens the path box on tidy.md: seven Backspaces leave the
// rules folder and neat.md renames it. A opens the path box at the rules
// folder, n and Tab complete to neat.md (the completion's screenshot), and Esc
// cancels; A again and fresh.md creates it, :q closes its editor, Option+h to
// the tree and d asks to move it to the Trash, y does. R rescans: eight entries
// and neat.md. / filters the tree to neat and Enter keeps the filter, leaving
// Global, Rules and neat.md; gg selects Global, Enter steps into Rules, the
// first child the filter shows, and Enter again into neat.md; k k j j selects
// neat.md and d asks to trash it, n keeps it, d again and Esc keeps it; / and
// Esc clear the filter. / filters to zqzq, which matches nothing, and Enter
// keeps it; / and Esc clear it. h goes up to Rules and h again collapses it. j
// l expands Hooks and j l opens the hook's detail view; Option+l, i edits
// settings.json and :q closes it; Option+h back. j j l expands the plugin, j j
// l its Plugins group and j l opens the plugin's detail view; Option+l, i edits
// installed_plugins.json and :q closes it; Option+h back. k k l expands the
// plugin's Skills and j l opens its cached SKILL.md; Option+l, j and k scroll,
// Ctrl+j and Ctrl+k scroll half a page, and i refuses to edit it in the plugin
// cache; Option+h back. a opens the kind picker, j k j l picks rule, and Esc
// cancels its place picker. c opens the context picker, Space v t hides the
// side bar under it, j Enter picks the repo, and Space v t shows the side bar
// again. Space k d hides the side bar, focusing the doc, and Option+h brings it
// back; Space k d hides it again and once more shows it; Space v t hides it and
// shows it again; Option+h focuses the tree. Space k s shows Sessions mode on
// the docs session's Docs tab (the session tab's screenshot), where R reads its
// session index, Space v t hides its tree, Option+h shows it, Space v t hides
// and shows it again, and Option+h focuses the tree. / filters it to a long
// filter matching nothing and Enter keeps it, / and Esc clear it; / filters it
// to style and Enter keeps it, and / and Esc clear it. a opens the kind picker.
// Space k d shows Docs mode, which closes that picker, so j moves Docs mode's
// tree. / filters it to neat and Enter keeps the filter; j j j j selects
// neat.md and r opens the path box, where seven Backspaces and kept.md rename
// it, and the session's view reads its index again; / and Esc clear the filter,
// so the tree shows its rows. Space z g, t and Space k d show Docs mode under
// reduced transparency, and Space z g, t and Space k d again under full.
function docsSteps(paths: Paths, homeDir: string): SelfTestStep[] {
  // A path below the home as the page shows it.
  const shown = (relative: string) =>
    paths.tilde(paths.join(homeDir, relative), homeDir);
  return [
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] showed Docs mode',
      checksFit: true,
    },
    { keys: ['R'], expect: '[docs] index rebuilt: 8 entries' },
    { keys: ['G'], expect: '[docs] selected Features' },
    { keys: ['g', 'g'], expect: '[docs] selected Global' },
    { keys: ['j', 'l'], expect: '[docs] expanded Instructions' },
    { keys: ['j', 'l'], expect: '[docs] opened CLAUDE.md', checksFit: true },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['<C-j>'], expect: '[docs] scrolled CLAUDE.md down half a page' },
    {
      keys: ['<C-k>'],
      expect: '[docs] scrolled CLAUDE.md up half a page to the top',
    },
    { keys: ['i'], expect: '[docs] editing CLAUDE.md' },
    {
      keys: ['<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down half a page; the cursor moved',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page to the top; the cursor stayed',
    },
    {
      keys: ['G', '<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page; the cursor moved',
    },
    {
      keys: ['g', 'g', 'V', '<C-j>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md down half a page; the cursor moved',
    },
    {
      keys: ['<C-k>'],
      expect:
        '[docs] scrolled the editor on CLAUDE.md up half a page to the top; the cursor moved',
    },
    {
      keys: ['Escape', ':', 'q', 'Enter'],
      expect: '[docs] closed the editor on CLAUDE.md',
    },
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
      expect: '[docs] refused :q with unsaved edits on style.md',
    },
    {
      keys: [':', 'q', '!', 'Enter'],
      expect: '[docs] dropped edits on style.md',
    },
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
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
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
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: ['d'],
      expect: '[docs] asked to move fresh.md to the Trash',
      checksFit: true,
    },
    { keys: ['y'], expect: '[docs] moved fresh.md to the Trash' },
    { keys: ['R'], expect: '[docs] index rebuilt: 9 entries' },
    {
      keys: ['/', ...'neat', 'Enter'],
      expect: '[docs] filtered the tree: neat',
    },
    // Global's first child, Instructions, holds no match, so Enter steps into
    // Rules, the first child the filter shows.
    { keys: ['g', 'g'], expect: '[docs] selected Global' },
    { keys: ['Enter'], expect: '[docs] selected Rules' },
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
    { keys: ['k', 'k', 'l'], expect: '[docs] expanded Skills' },
    { keys: ['j', 'l'], expect: '[docs] opened SKILL.md' },
    { keys: ['<A-l>'], expect: '[docs] doc focused' },
    { keys: ['j'], expect: '[page] j ran docs.scrollDown' },
    { keys: ['k'], expect: '[page] k ran docs.scrollUp' },
    { keys: ['<C-j>'], expect: '[page] <C-j> ran docs.halfPageDown' },
    { keys: ['<C-k>'], expect: '[page] <C-k> ran docs.halfPageUp' },
    {
      keys: ['i'],
      expect: '[docs] refused to edit SKILL.md in the plugin cache',
    },
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    { keys: ['a'], expect: '[docs] create: pick a kind' },
    { keys: ['j', 'k', 'j', 'l'], expect: '[docs] create rule: pick a place' },
    { keys: ['Escape'], expect: '[docs] create cancelled' },
    { keys: ['c'], expect: '[page] c ran docs.pickContext', checksFit: true },
    // The picker keeps its keys through the side bar hiding under it.
    { keys: [' ', 'v', 't'], expect: '[page] side bar hidden' },
    {
      keys: ['j', 'Enter'],
      expect: `[docs] context ${shown('dev/selftest-repo')}`,
    },
    { keys: [' ', 'v', 't'], expect: '[page] side bar shown' },
    {
      keys: [' ', 'k', 'd'],
      expect: '[page] side bar hidden',
      checksFit: true,
    },
    { keys: ['<A-h>'], expect: '[page] side bar shown' },
    { keys: [' ', 'k', 'd'], expect: '[page] side bar hidden' },
    { keys: [' ', 'k', 'd'], expect: '[page] side bar shown' },
    { keys: [' ', 'v', 't'], expect: '[page] side bar hidden' },
    { keys: [' ', 'v', 't'], expect: '[page] side bar shown' },
    // Both views' pane scope is now tree, so only closing the session view's
    // kind picker on Docs mode's show frees `j` there. The picker holds no
    // text box, so Space reaches the leader.
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    {
      keys: [' ', 'k', 's'],
      expect: '[docs] Docs tab shown',
      checksFit: true,
      screenshot: 'session-tab',
    },
    { keys: ['R'], expect: '[docs] session index read: 4 entries' },
    { keys: [' ', 'v', 't'], expect: '[docs] tree hidden', checksFit: true },
    // Option+h reveals the hidden tree.
    { keys: ['<A-h>'], expect: '[docs] tree shown' },
    { keys: [' ', 'v', 't'], expect: '[docs] tree hidden' },
    { keys: [' ', 'v', 't'], expect: '[docs] tree shown' },
    // The tree scope back for the filter and the kind picker.
    { keys: ['<A-h>'], expect: '[docs] tree focused' },
    // The session split keeps its tree at the fit check's width, where Docs
    // mode hides its side bar, so the tree's lines are checked here.
    {
      keys: ['/', ...UNMATCHED_FILTER, 'Enter'],
      expect: `[docs] no docs match "${UNMATCHED_FILTER}"`,
      checksFit: true,
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    {
      keys: ['/', ...'style', 'Enter'],
      expect: '[docs] filtered the tree: style',
      checksFit: true,
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
    { keys: ['a'], expect: '[docs] create: pick a kind' },
    { keys: [' ', 'k', 'd'], expect: '[page] marked Docs in the activity bar' },
    { keys: ['j'], expect: '[page] j ran docs.treeDown' },
    {
      keys: ['/', ...'neat', 'Enter'],
      expect: '[docs] filtered the tree: neat',
    },
    {
      keys: ['j', 'j', 'j', 'j', 'r'],
      expect: '[docs] rename: type the new path',
    },
    // The session view has read its index, so the rename runs it again.
    {
      keys: [...Array<string>(7).fill('Backspace'), ...'kept.md', 'Enter'],
      expect: '[docs] session index read: 4 entries',
    },
    { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
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

// Rewrites the fixture under `homeDir` and connects a session with host id
// `sessionId` in the fixture's repo, then activates its row, which shows its
// only tab, the Docs tab. A failed activation ends the session it connected.
export async function connectDocsFixtureSession(
  files: Files,
  homeDir: string,
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>,
  sessionId: string,
  paths: Paths,
): Promise<ConnectedSession> {
  await writeDocsFixture(files, homeDir, paths);
  const home = await files.realPath(homeDir);
  const connected = sessions.connect({
    sessionId,
    projectDir: paths.join(home, 'dev', 'selftest-repo'),
    deadlineSeconds: null,
    harness: 'claude',
  });
  try {
    sessions.activate(connected.session.id);
  } catch (error) {
    connected.end();
    throw error;
  }
  return connected;
}

// Each run ends the previous run's docs session and connects a fresh one over
// a rewritten fixture. The result is null once that chain has run, else the
// error it failed with.
export function docsSelfTestScript(deps: DocsSelfTestDeps): SelfTestScript {
  const { files, homeDir, sessions, paths } = deps;
  let previous: ConnectedSession | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: SCROLLS_ITSELF,
    open(run) {
      previous?.end();
      previous = null;
      const result = (async (): Promise<string | null> => {
        try {
          previous = await connectDocsFixtureSession(
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
    steps: docsSteps(paths, homeDir),
    problems: (result) =>
      result === null ? [] : [`fixture not ready: ${String(result)}`],
  };
}
