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

// Space k d shows Docs mode, whose first show builds the index: the fixture's
// eight entries. j to Global's Instructions and l expands it; j to the
// self-test instructions and l opens CLAUDE.md. Ctrl+l focuses the doc; Tab
// reaches its first link, the style rule, and Enter follows it. i edits
// style.md; o types a new line below, Esc to normal mode and :w writes it; :q
// closes the editor. i again, x deletes a character, so :q is refused and :q!
// drops the edit. Ctrl+h back to the tree; a asks for a kind, j Enter picks
// rule, Enter its one place, and tidy names it, which creates tidy.md and opens
// it in the editor; :q closes it. Ctrl+h to the tree, where r opens the path
// box on tidy.md: seven Backspaces leave the rules folder and neat.md renames
// it. A opens the path box at the rules folder, n and Tab complete to neat.md,
// and Esc cancels; A again and fresh.md creates it, :q closes its editor,
// Ctrl+h to the tree and d asks to move it to the Trash, y does. R rescans:
// eight entries and neat.md. c opens the context picker, j Enter picks the
// repo. Space k d hides the tree and again shows it; Space k s shows Sessions
// mode on the docs session's Docs tab, where R reads its session index.
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
  { keys: ['i'], expect: '[docs] editing style.md', checksFit: true },
  {
    keys: ['o', ...'new line', 'Escape', ':', 'w', 'Enter'],
    expect: '[docs] wrote style.md',
  },
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
  { keys: ['c'], expect: '[page] c ran docs.pickContext', checksFit: true },
  { keys: ['j', 'Enter'], expect: '[docs] context ~/dev/selftest-repo' },
  { keys: [' ', 'k', 'd'], expect: '[docs] tree hidden', checksFit: true },
  { keys: [' ', 'k', 'd'], expect: '[docs] tree shown' },
  { keys: [' ', 'k', 's'], expect: '[docs] Docs tab shown', checksFit: true },
  { keys: ['R'], expect: '[docs] session index read: 4 entries' },
];

// Row titles, paths and the status line end in an ellipsis; the field table,
// the completion list and the editor scroll in their own box; and Sessions
// mode's row and tab labels end in an ellipsis.
const SCROLLS_ITSELF = [
  '.docs-row-title',
  '.docs-path',
  '.docs-status',
  '.docs-frontmatter',
  '.docs-completion',
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
