import type { Files } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { Paths } from '../../../contracts/paths';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import {
  BACKLOG_FEATURES_HOME,
  BACKLOG_FOLLOWUPS,
  BACKLOG_REPO,
  FIXTURE_COMMIT_SUBJECT,
  runGit,
  writeBacklogFixture,
} from './selftest-fixture';

export interface BacklogSelfTestDeps {
  files: Files;
  processes: ProcessRunner;
  git: Git;
  paths: Paths;
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  // Settles once the fixture main wrote at start is on disk, so a run's
  // rewrite never races it.
  started: Promise<unknown>;
  // Tells the page to read the homes again.
  reload(): void;
}

// Docs' list-shaped follow-ups file, relative to the temp home, and the text
// a step writes over it from outside the app.
const LIST_FOLLOWUPS = 'wigley-features/selftest-repo/followups.md';
const LIST_WITH_OUTSIDE_ITEM =
  '# Follow-ups\n\n- **First follow-up** — waits.\n- **Outside item** — written on disk.\n';

// The follow-up the steps create, the text the edit adds to its title, and
// its one line and body.
const CREATED = 'Zesty';
const RENAME_SUFFIX = 'Two';
const RENAMED = `${CREATED}${RENAME_SUFFIX}`;
const CREATED_ONE_LINE = 'tidy';
const CREATED_BODY = 'Body';

const COMMIT_SUBJECT = 'Follow-ups edited in Backlog: tagged Plain item';

// How long one result check waits for the disk to show a step's write, and
// how often it looks.
const CHECK_TIMEOUT_MS = 60_000;
const POLL_MS = 25;

function backlogGroups(paths: Paths, homeDir: string): SelfTestGroup[] {
  // A path below the home as the page shows it.
  const shown = (relative: string) =>
    paths.tilde(paths.join(homeDir, relative), homeDir);
  const gitHome = shown(BACKLOG_FEATURES_HOME);
  const openedGitHome = `[backlog] opened backlog-repo ${gitHome}`;
  const open: SelfTestStep[] = [
    { keys: [' ', 'k', 'b'], expect: '[backlog] shown', checksFit: true },
    {
      keys: ['R'],
      expect: '[backlog] loaded 2 homes',
      why: 'The side bar lists the git home and the list-shaped home.',
    },
    { keys: ['g', 'g', 'l'], expect: openedGitHome },
    {
      keys: ['Enter'],
      expect: '[backlog] list focused',
      why: 'l opened the home and kept focus on the homes; Enter on the open home focuses its list.',
    },
    { keys: ['j'], expect: '[backlog] selected Plain item' },
    {
      keys: ['j'],
      expect: '[backlog] selected Backlog X',
      checksFit: true,
      screenshot: 'home',
      why: 'The struck item is hidden, so the plan follows the untagged item; the screenshot shows agent-ready on the first row.',
    },
  ];
  const doneAndFilter: SelfTestStep[] = [
    { keys: [' ', 'v', 'd'], expect: '[backlog] done shown' },
    {
      keys: ['k'],
      expect: '[backlog] selected Shipped item',
      why: 'The struck item now shows above the plan.',
    },
    { keys: [' ', 'v', 'd'], expect: '[backlog] done hidden' },
    { keys: ['k'], expect: '[backlog] selected Plain item' },
    {
      keys: [' ', 'v', 'a'],
      expect: '[backlog] selected Ready item',
      why: 'Only the tagged item shows, so the selection leaves the untagged one for it.',
    },
    { keys: [' ', 'v', 'a'], expect: '[backlog] agent-ready only off' },
    {
      keys: ['/', ...'plain'],
      expect: '[backlog] selected Plain item',
      why: 'The filter hides the tagged item, so the selection moves to the match.',
    },
    { keys: ['Enter'], expect: '[backlog] filter plain' },
    {
      keys: ['/', 'Escape', 'k'],
      expect: '[backlog] selected Ready item',
      why: '/ then Esc clears the filter, so the tagged item shows above the match again.',
    },
    { keys: ['j'], expect: '[backlog] selected Plain item' },
  ];
  const tag: SelfTestStep[] = [
    {
      keys: ['t'],
      expect: '[backlog] loaded 2 homes',
      why: 'The write reloads the homes; the result checks the Contents line and the uncommitted file.',
    },
  ];
  const createAndEdit: SelfTestStep[] = [
    { keys: ['a'], expect: '[backlog] editor open create' },
    {
      keys: [...CREATED, '<Tab>'],
      expect: '[backlog] focused One line box',
    },
    {
      keys: ['i', ...CREATED_ONE_LINE, '<Tab>', '<Tab>'],
      expect: '[backlog] focused Body box',
    },
    {
      keys: ['i', ...CREATED_BODY, '<S-Tab>'],
      expect: '[backlog] focused Tags (comma-separated) box',
      checksFit: true,
      screenshot: 'editor',
      why: "The screenshot shows the editor's filled boxes and the git home's uncommitted tag.",
    },
    {
      keys: ['<D-Enter>'],
      expect: `[backlog] selected ${CREATED}`,
      why: 'A saved create closes the editor and selects the new follow-up.',
    },
    { keys: ['i'], expect: '[backlog] editor open edit' },
    {
      keys: [...RENAME_SUFFIX, '<D-Enter>'],
      expect: `[backlog] selected ${RENAMED}`,
    },
  ];
  const deleteItem: SelfTestStep[] = [
    { keys: ['k'], expect: '[backlog] selected Plain item' },
    { keys: ['j'], expect: `[backlog] selected ${RENAMED}` },
    {
      keys: ['d', 'y'],
      expect: '[backlog] selected Backlog X',
      why: 'The deleted row leaves the list, so the selection moves to the plan in its place.',
    },
  ];
  const outsideChange: SelfTestStep[] = [
    {
      keys: ['h', 'j', 'Enter'],
      expect: `[backlog] opened selftest-repo ${shown('wigley-features/selftest-repo')}`,
    },
    {
      writeFile: { path: LIST_FOLLOWUPS, text: LIST_WITH_OUTSIDE_ITEM },
      keys: [],
      expect: '[backlog] loaded 2 homes',
    },
    {
      keys: ['G'],
      expect: '[backlog] selected Outside item',
      why: 'The item written on disk shows with no rescan.',
    },
  ];
  const commit: SelfTestStep[] = [
    { keys: ['h', 'k', 'Enter'], expect: openedGitHome },
    {
      keys: ['C'],
      expect: `[backlog] committed ${gitHome}`,
      why: 'The result checks the commit subject and that the home is clean.',
    },
  ];
  const plan: SelfTestStep[] = [
    { keys: ['G'], expect: '[backlog] selected Backlog X' },
    {
      keys: ['Enter', 'j'],
      expect: '[backlog] selected First task',
      why: "Enter expands the plan's task rows.",
    },
    { keys: ['j'], expect: '[backlog] selected Second task' },
  ];
  const sideBarKeys: SelfTestStep[] = [
    {
      keys: ['<A-h>'],
      expect: '[backlog] homes focused',
      why: "Option+h at the list's left edge reaches the homes through the mode's focusSideBar.",
    },
    { keys: ['<A-l>'], expect: '[backlog] list focused' },
    { keys: ['<A-l>'], expect: '[backlog] detail focused' },
    { keys: ['<A-h>'], expect: '[backlog] list focused' },
    { keys: ['h'], expect: '[backlog] homes focused' },
    {
      keys: ['<A-l>'],
      expect: '[backlog] list focused',
      why: 'h left the homes holding the keys with the area at main, so the view steps out of them.',
    },
    {
      keys: ['h', 'j', 'l'],
      expect: `[backlog] opened selftest-repo ${shown('wigley-features/selftest-repo')}`,
    },
    {
      keys: ['k', 'Enter'],
      expect: openedGitHome,
      alsoExpect: [/^\[backlog\] list focused$/],
      why: 'l kept focus on the homes, so k moved the homes cursor back to the git home.',
    },
    { keys: ['a'], expect: '[backlog] editor open create' },
    {
      keys: ['<A-h>'],
      expect: '[backlog] pane keys ignored: the editor is open',
    },
    {
      keys: ['Escape', 'Escape', 'Escape'],
      expect: '[backlog] editor closed',
      why: 'Esc leaves insert mode, then the box, then cancels the unchanged editor.',
    },
  ];
  const detailAndTagPicker: SelfTestStep[] = [
    { keys: ['<A-l>'], expect: '[backlog] detail focused' },
    { keys: ['G'], expect: '[backlog] scrolled the detail to the end' },
    { keys: ['g', 'g'], expect: '[backlog] scrolled the detail to the top' },
    { keys: ['<A-h>'], expect: '[backlog] list focused' },
    {
      keys: ['j'],
      expect: '[backlog] selected Plain item',
      why: 'Reopening the git home in the side bar keys group put the cursor on its first row, so j leaves it for gg to return.',
    },
    { keys: ['g', 'g'], expect: '[backlog] selected Ready item' },
    { keys: ['T'], expect: '[backlog] picker shown: Tags' },
    { keys: ['G'], expect: '[page] G ran backlog.pickerBottom' },
    { keys: ['g', 'g'], expect: '[page] gg ran backlog.pickerTop' },
    { keys: ['/'], expect: '[backlog] picker filter: Tags' },
    { keys: ['Escape', 'Escape'], expect: '[backlog] picker list: Tags' },
    {
      keys: ['Escape'],
      expect: '[page] Escape ran backlog.pickerCancel',
      why: 'Closing the picker writes no tag.',
    },
  ];
  return [
    {
      name: 'open',
      why: 'Space k b shows Backlog with both homes in the side bar; the git home lists its two open follow-ups, the struck one hidden, then its plan.',
      steps: open,
    },
    {
      name: 'done and filter',
      why: 'Space v d shows and hides the struck item, Space v a keeps only the agent-ready item, and / narrows the list by a title fragment.',
      steps: doneAndFilter,
    },
    {
      name: 'tag',
      why: 't tags the untagged item agent-ready in its Contents line, leaving the file uncommitted.',
      steps: tag,
    },
    {
      name: 'create and edit',
      why: "a creates a follow-up from the editor's boxes, and i renames it; each save rewrites the Contents line and the section.",
      steps: createAndEdit,
    },
    {
      name: 'delete',
      why: "d and y delete a follow-up's section and Contents line.",
      steps: deleteItem,
    },
    {
      name: 'outside change',
      why: 'An item written to a follow-up file outside the app shows in the list without a rescan.',
      steps: outsideChange,
    },
    {
      name: 'commit',
      why: "C commits the git home's follow-up files under a Backlog subject.",
      steps: commit,
    },
    {
      name: 'plan',
      why: 'Selecting the plan shows it, Enter expands its task rows, and j selects them.',
      steps: plan,
    },
    {
      name: 'side bar keys',
      why: 'Option+h and Option+l move between the list, the homes and the detail; h still reaches the homes and Option+l steps out of them; l on a home opens it keeping focus and Enter opens it focusing the list; the open editor ignores the pane keys.',
      steps: sideBarKeys,
    },
    {
      name: 'detail and tag picker',
      why: 'In the detail gg and G scroll to its top and end; the tag picker takes the shared list keys, its filter included, and Esc closes it unchosen.',
      steps: detailAndTagPicker,
    },
  ];
}

// Whether `probe` answers true within `timeoutMs`, asking every `POLL_MS`; a
// probe that rejects counts as false.
async function holdsWithin(
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

// The checks the result runs in order over the git home's follow-ups file,
// each naming the state the steps' writes leave it in.
const FILE_CHECKS: readonly {
  what: string;
  holds(lines: string[]): boolean;
}[] = [
  {
    what: 'the untagged item tagged agent-ready',
    holds: (lines) =>
      lines.includes('- **Plain item** — *agent-ready*: needs a look'),
  },
  {
    what: `the created ${CREATED}`,
    holds: (lines) =>
      lines.includes(`- **${CREATED}** — ${CREATED_ONE_LINE}`) &&
      lines.includes(`## ${CREATED}`) &&
      lines.includes(CREATED_BODY),
  },
  {
    what: `${CREATED} renamed ${RENAMED}`,
    holds: (lines) =>
      lines.includes(`- **${RENAMED}** — ${CREATED_ONE_LINE}`) &&
      lines.includes(`## ${RENAMED}`) &&
      !lines.includes(`## ${CREATED}`),
  },
  {
    what: `${RENAMED} deleted`,
    holds: (lines) => !lines.some((line) => line.includes(RENAMED)),
  },
];

// Follows the steps' writes on disk and in git, returning what was wrong.
// The file checks run in order, the tag's also checking the file is
// uncommitted; then the commit's subject and a clean home are checked.
async function followWrites(deps: BacklogSelfTestDeps): Promise<string[]> {
  const { files, processes, git, paths } = deps;
  const home = await files.realPath(deps.homeDir);
  const repo = paths.join(home, BACKLOG_REPO);
  const followups = paths.join(home, BACKLOG_FOLLOWUPS);
  const problems: string[] = [];
  const isUncommitted = async () =>
    (await git.changedPaths(repo, 'docs/features')).includes(
      'docs/features/followups.md',
    );
  for (const [index, check] of FILE_CHECKS.entries()) {
    const held = await holdsWithin(
      async () => check.holds((await files.read(followups)).split('\n')),
      CHECK_TIMEOUT_MS,
    );
    if (!held) {
      problems.push(`followups.md never held ${check.what}`);
    } else if (index === 0 && !(await isUncommitted())) {
      problems.push('followups.md not uncommitted after the tag');
    }
  }
  let subject = FIXTURE_COMMIT_SUBJECT;
  const isCommitted = await holdsWithin(async () => {
    subject = (
      await runGit(processes, repo, ['log', '-1', '--format=%s'])
    ).trim();
    return subject !== FIXTURE_COMMIT_SUBJECT;
  }, CHECK_TIMEOUT_MS);
  if (!isCommitted) {
    problems.push('the home was never committed');
  } else if (subject !== COMMIT_SUBJECT) {
    problems.push(`commit subject "${subject}"`);
  } else if (await isUncommitted()) {
    problems.push('followups.md uncommitted after the commit');
  }
  return problems;
}

// Each run rewrites the fixture repo, once the one before it is written, and
// tells the page to read the homes again. The result lists what was wrong
// with the fixture or the writes the steps make, empty when nothing was.
export function backlogSelfTestScript(
  deps: BacklogSelfTestDeps,
): SelfTestScript {
  let written: Promise<unknown> = deps.started;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      const fixture = written
        .catch(() => undefined)
        .then(() => writeBacklogFixture(deps, deps.homeDir));
      written = fixture;
      const result = fixture.then(
        () => {
          deps.reload();
          return followWrites(deps);
        },
        (error: unknown) => [`fixture not ready: ${errorText(error)}`],
      );
      return { shownLine: '[backlog] loaded 2 homes', result };
    },
    groups: backlogGroups(deps.paths, deps.homeDir),
    problems: (result) => result as string[],
  };
}
