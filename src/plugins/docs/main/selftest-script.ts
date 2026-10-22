import type { Files } from '../../../contracts/files';
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
}

// The fixture's style rule, relative to the temp home, and the texts the steps
// write over it from outside the app.
const STYLE_RULE_FILE = '.claude/rules/style.md';
const STYLE_RELOADED = '# Style\n\nWrite short lines.\nChanged on disk.\n';
const STYLE_CHANGED_WHILE_EDITING =
  '# Style\n\nWrite short lines.\nChanged while editing.\n';

// Space k d shows Docs mode, whose first show builds the index: the fixture's
// eight entries. j to Global's Instructions and l expands it; j to the
// self-test instructions and l opens CLAUDE.md. Ctrl+l focuses the doc; Tab
// reaches its first link, the style rule, and Enter follows it. A change on
// disk reloads style.md. i edits it, and a second change on disk shows the
// changed-on-disk banner. o types a new line below, Esc to normal mode and :w
// meets the changed-on-disk prompt, where r reloads the disk's text. Another
// change on disk, a new line and :w again, and o overwrites the disk. A third,
// and Esc keeps editing; :w shows the prompt again and o overwrites. :q
// closes the editor. i again, x deletes a character, so :q is refused and :q!
// drops the edit. Ctrl+h back to the tree; a asks for a kind, j Enter picks
// rule, Enter its one place, and tidy names it, which creates tidy.md and opens
// it in the editor; :q closes it. Ctrl+h to the tree, where r opens the path
// box on tidy.md: seven Backspaces leave the rules folder and neat.md renames
// it. A opens the path box at the rules folder, n and Tab complete to neat.md,
// and Esc cancels; A again and fresh.md creates it, :q closes its editor,
// Ctrl+h to the tree and d asks to move it to the Trash, y does. R rescans:
// eight entries and neat.md. / filters the tree to neat and Enter keeps the
// filter, leaving Global, Rules and neat.md; k k j j selects neat.md and d
// asks to trash it, n keeps it, d again and Esc keeps it; / and Esc clear the
// filter. h goes up to Rules and h again collapses it. j l expands Hooks and
// j l opens the hook's detail view; Ctrl+l, i edits settings.json and :q
// closes it; Ctrl+h back. j j l expands the plugin, j j l its Plugins group
// and j l opens the plugin's detail view; Ctrl+l, i edits
// installed_plugins.json and :q closes it; Ctrl+h back. k k l expands the
// plugin's Skills and j l opens its cached SKILL.md; Ctrl+l, j and k scroll,
// and i refuses to edit it in the plugin cache; Ctrl+h back. a opens the kind
// picker, j k j l picks rule, and Esc cancels its place picker. c opens the
// context picker, j Enter picks the repo. Space k d hides the tree, focusing
// the doc, and again shows it; Ctrl+h focuses the tree. Space k s shows
// Sessions mode on the docs session's Docs tab, where R reads its session
// index and a opens the kind picker. Space k d shows Docs mode, which closes
// that picker, so j moves Docs mode's tree. / filters it to neat and Enter
// keeps the filter; j j j j selects neat.md and r opens the path box, where
// seven Backspaces and kept.md rename it, and the session's view reads its
// index again. Space z g, t and Space k d show Docs mode under reduced
// transparency, and Space z g, t and Space k d again under full.
const STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'k', 'd'],
    expect: '[docs] index rebuilt: 8 entries',
    checksFit: true,
  },
  { keys: ['j', 'l'], expect: '[docs] expanded Instructions' },
  { keys: ['j', 'l'], expect: '[docs] opened CLAUDE.md', checksFit: true },
  { keys: ['<C-l>'], expect: '[docs] doc focused' },
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
  { keys: [':', 'q', 'Enter'], expect: '[docs] closed the editor on style.md' },
  { keys: ['i'], expect: '[docs] editing style.md' },
  {
    keys: ['x', ':', 'q', 'Enter'],
    expect: '[docs] refused :q with unsaved edits on style.md',
  },
  {
    keys: [':', 'q', '!', 'Enter'],
    expect: '[docs] dropped edits on style.md',
  },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  { keys: ['a'], expect: '[docs] create: pick a kind', checksFit: true },
  { keys: ['j', 'Enter'], expect: '[docs] create rule: pick a place' },
  { keys: ['Enter'], expect: '[docs] create rule: name it' },
  { keys: [...'tidy', 'Enter'], expect: '[docs] created tidy.md' },
  { keys: [':', 'q', 'Enter'], expect: '[docs] closed the editor on tidy.md' },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  { keys: ['r'], expect: '[docs] rename: type the new path', checksFit: true },
  {
    keys: [...Array<string>(7).fill('Backspace'), ...'neat.md', 'Enter'],
    expect: '[docs] renamed tidy.md to neat.md',
  },
  { keys: ['A'], expect: '[docs] create by path: type the path' },
  {
    keys: ['n', 'Tab'],
    expect: '[docs] completed to ~/.claude/rules/neat.md',
    checksFit: true,
  },
  { keys: ['Escape'], expect: '[docs] create cancelled' },
  { keys: ['A'], expect: '[docs] create by path: type the path' },
  { keys: [...'fresh.md', 'Enter'], expect: '[docs] created fresh.md' },
  { keys: [':', 'q', 'Enter'], expect: '[docs] closed the editor on fresh.md' },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
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
  {
    keys: ['k', 'k', 'j', 'j', 'd'],
    expect: '[docs] asked to move neat.md to the Trash',
  },
  { keys: ['n'], expect: '[docs] kept neat.md' },
  { keys: ['d'], expect: '[docs] asked to move neat.md to the Trash' },
  { keys: ['Escape'], expect: '[docs] kept neat.md' },
  { keys: ['/', 'Escape'], expect: '[docs] cleared the filter' },
  { keys: ['h', 'h'], expect: '[docs] collapsed Rules' },
  { keys: ['j', 'l'], expect: '[docs] expanded Hooks' },
  { keys: ['j', 'l'], expect: '[docs] opened settings.json' },
  { keys: ['<C-l>'], expect: '[docs] doc focused' },
  { keys: ['i'], expect: '[docs] editing settings.json' },
  {
    keys: [':', 'q', 'Enter'],
    expect: '[docs] closed the editor on settings.json',
  },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  {
    keys: ['j', 'j', 'l'],
    expect: '[docs] expanded selftest-plugin@selftest-market',
  },
  { keys: ['j', 'j', 'l'], expect: '[docs] expanded Plugins' },
  { keys: ['j', 'l'], expect: '[docs] opened 1.0.0' },
  { keys: ['<C-l>'], expect: '[docs] doc focused' },
  { keys: ['i'], expect: '[docs] editing installed_plugins.json' },
  {
    keys: [':', 'q', 'Enter'],
    expect: '[docs] closed the editor on installed_plugins.json',
  },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  { keys: ['k', 'k', 'l'], expect: '[docs] expanded Skills' },
  { keys: ['j', 'l'], expect: '[docs] opened SKILL.md' },
  { keys: ['<C-l>'], expect: '[docs] doc focused' },
  { keys: ['j'], expect: '[page] j ran docs.scrollDown' },
  { keys: ['k'], expect: '[page] k ran docs.scrollUp' },
  {
    keys: ['i'],
    expect: '[docs] refused to edit SKILL.md in the plugin cache',
  },
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  { keys: ['a'], expect: '[docs] create: pick a kind' },
  { keys: ['j', 'k', 'j', 'l'], expect: '[docs] create rule: pick a place' },
  { keys: ['Escape'], expect: '[docs] create cancelled' },
  { keys: ['c'], expect: '[page] c ran docs.pickContext', checksFit: true },
  { keys: ['j', 'Enter'], expect: '[docs] context ~/dev/selftest-repo' },
  { keys: [' ', 'k', 'd'], expect: '[docs] tree hidden', checksFit: true },
  { keys: [' ', 'k', 'd'], expect: '[docs] tree shown' },
  // Both views' pane scope is now tree, so only closing the session view's
  // kind picker on Docs mode's show frees `j` there. The picker holds no
  // text box, so Space reaches the leader.
  { keys: ['<C-h>'], expect: '[docs] tree focused' },
  { keys: [' ', 'k', 's'], expect: '[docs] Docs tab shown', checksFit: true },
  { keys: ['R'], expect: '[docs] session index read: 4 entries' },
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

// Row titles, paths, the status line and completions end in an ellipsis; the
// field table's box and the editor scroll themselves; and Sessions mode's row
// and tab labels end in an ellipsis.
const SCROLLS_ITSELF = [
  '.docs-row-title',
  '.docs-path',
  '.docs-status',
  '.docs-completion-item',
  '.docs-frontmatter-box',
  '.docs-editor',
  '.session-row-label',
  '.session-row-status',
  '.session-tab-label',
];

// Each run ends the previous run's docs session, rewrites the fixture, and
// connects a fresh session in the fixture's repo, whose activation shows its
// only tab, the Docs tab. The result is null once that chain has run, else
// the error it failed with.
export function docsSelfTestScript(deps: DocsSelfTestDeps): SelfTestScript {
  const { files, homeDir, sessions } = deps;
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
          await writeDocsFixture(files, homeDir);
          const home = await files.realPath(homeDir);
          const connected = sessions.connect({
            sessionId: `docs-selftest-${run}`,
            projectDir: `${home}/dev/selftest-repo`,
            deadlineSeconds: null,
            harness: 'claude',
          });
          previous = connected;
          sessions.activate(connected.session.id);
          return null;
        } catch (error) {
          return errorText(error);
        }
      })();
      return { shownLine: '[sessions] activated selftest-repo', result };
    },
    steps: STEPS,
    problems: (result) =>
      result === null ? [] : [`fixture not ready: ${String(result)}`],
  };
}
