import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { holdsWithin } from '../../../shared/holds-within';
import { writePracticeFixture } from './selftest-fixture';

export interface PracticeSelfTestDeps {
  files: Files;
  paths: Paths;
  processes: ProcessRunner;
  // The practice folder main resolves from the `folder` setting.
  folder(): string;
  // The `compiler` setting.
  compiler(): string;
  // Tells the page to list the problems again.
  reload(): void;
}

// How long the result waits, from the submit's start, for the disk to show
// its record.
const CHECK_TIMEOUT_MS = 60_000;

// How long the Run and Submit steps wait for their result line: a cold
// compiler start can take far longer than the run's default step wait.
const COMPILE_STEP_TIMEOUT_MS = 60_000;

// The problem the steps submit.
const SUBMITTED_SLUG = 'lru-cache';

// `submitStarted` hears each submit main's channel starts.
export interface PracticeSelfTestScript extends SelfTestScript {
  submitStarted(slug: string): void;
}

const practiceGroups: SelfTestGroup[] = [
  {
    name: 'list',
    why: 'Space k p shows Practice with both fixture problems, Two Sum (easy) above LRU Cache (medium), the list holding the keys; j and k move the cursor; / with a difficulty word keeps only that difficulty, and / then Esc clears it.',
    steps: [
      {
        keys: [' ', 'k', 'p'],
        expect: '[practice] shown',
        checksFit: true,
        screenshot: 'list',
      },
      {
        keys: ['j'],
        expect: '[practice] selected lru-cache',
        why: 'The list holds the keys on the first show.',
      },
      { keys: ['k'], expect: '[practice] selected two-sum' },
      {
        keys: ['/', ...'medium'],
        expect: '[practice] selected lru-cache',
        why: 'The filter hides Two Sum, so the cursor moves to the match.',
      },
      { keys: ['Enter'], expect: '[practice] filter medium' },
      {
        keys: ['/', 'Escape', 'k'],
        expect: '[practice] selected two-sum',
        why: '/ then Esc clears the filter, so Two Sum shows above again.',
      },
    ],
  },
  {
    name: 'open and run',
    why: "Enter opens Two Sum's statement, editor and console with the problem pane holding the keys; Cmd+' compiles the fixture's correct solution with the real compiler and runs both examples to Accepted.",
    steps: [
      {
        keys: ['Enter'],
        expect: '[practice] opened two-sum',
        alsoExpect: [/^\[practice\] problem focused$/],
        checksFit: true,
        screenshot: 'workspace',
        why: 'Each open focuses the problem pane, so the statement reads first.',
      },
      { keys: ["<D-'>"], expect: '[practice] run started two-sum' },
      {
        keys: [],
        expect: '[practice] run two-sum: accepted 2/2',
        timeoutMs: COMPILE_STEP_TIMEOUT_MS,
        screenshot: 'run-result',
      },
    ],
  },
  {
    name: 'solution peek',
    why: "The self-test window's column is too narrow for the problem pane beside the editor, so the three panes stack and Option+j and Option+k move through them; Option+o and gt step the problem pane's tabs, from the editor too; the Solution tab asks to confirm before it opens, and y opens it and marks the attempt peeked.",
    steps: [
      { keys: ['<A-j>'], expect: '[practice] editor focused' },
      { keys: ['<A-j>'], expect: '[practice] console focused' },
      { keys: ['<A-k>'], expect: '[practice] editor focused' },
      { keys: ['<A-o>'], expect: '[practice] problem tab Submissions' },
      { keys: ['<A-k>'], expect: '[practice] problem focused' },
      { keys: ['g', 't'], expect: '[practice] problem tab Notes' },
      {
        keys: ['g', 't'],
        expect: '[practice] solution confirm asked',
        screenshot: 'solution-confirm',
      },
      { keys: ['y'], expect: '[practice] peeked two-sum' },
    ],
  },
  {
    name: 'submit wrong answer',
    why: 'Submit of LRU Cache, whose get always returns -1, fails the design case with Wrong Answer and records one submission.',
    steps: [
      {
        keys: ['<A-h>'],
        expect: '[practice] list focused',
        why: "The problem pane is the column's left edge, and the outer panes turn left down while the column holds the keys, so Option+h reaches the list through the mode's side bar.",
      },
      { keys: ['j'], expect: '[practice] selected lru-cache' },
      { keys: ['Enter'], expect: '[practice] opened lru-cache' },
      { keys: ['<D-Enter>'], expect: '[practice] submit started lru-cache' },
      {
        keys: [],
        expect: '[practice] submit lru-cache: wrongAnswer 0/1',
        timeoutMs: COMPILE_STEP_TIMEOUT_MS,
        screenshot: 'wrong-answer',
      },
    ],
  },
  {
    name: 'interviewer',
    why: "The interviewer pane always shows under the editor and console, on LRU Cache's ask box; Space v i gives it the keys; Enter launches the interviewer over the fake harness and mounts its chat view; Option+k leaves the chat view for the column and Space v i returns; Option+h goes on to the list; another problem shows its own ask box, and LRU Cache brings its interviewer back. The pane is scoped-agents', so its lines log under that plugin.",
    steps: [
      {
        keys: [' ', 'v', 'i'],
        expect: '[scoped-agents] interviewer focused',
        width: 1400,
        checksFit: true,
        screenshot: 'ask-box',
        why: 'A window wide enough for the problem pane beside the code, the interviewer under the editor and console.',
      },
      {
        width: 'start',
        keys: [...'how do I start', 'Enter'],
        expect: '[scoped-agents] interviewer mounted lru-cache',
        screenshot: 'interviewer-chat',
      },
      {
        keys: ['<A-k>'],
        expect: '[scoped-agents] interviewer left',
        alsoExpect: [/^\[practice\] main focused$/],
        why: "The chat view turns Option+k down at its top edge, so Practice's outer panes give the column the keys.",
      },
      { keys: [' ', 'v', 'i'], expect: '[scoped-agents] interviewer focused' },
      {
        keys: ['<A-h>'],
        expect: '[practice] list focused',
        why: 'The pane leaves only upward, so Option+h goes on to the side bar.',
      },
      {
        keys: ['j'],
        expect: '[practice] selected two-sum',
        why: "The submit made LRU Cache attempted, and the list reloaded through main's changed, so LRU Cache sorts above Two Sum.",
      },
      {
        keys: ['Enter'],
        expect: '[scoped-agents] interviewer ask box shown for two-sum',
        alsoExpect: [/^\[practice\] opened two-sum$/],
        why: "Two Sum's attempt has no interviewer.",
      },
      { keys: ['<A-h>'], expect: '[practice] list focused' },
      {
        keys: ['k', 'Enter'],
        expect: '[scoped-agents] interviewer mounted lru-cache',
        alsoExpect: [/^\[practice\] opened lru-cache$/],
        why: "Reopening the problem brings back its attempt's interviewer.",
      },
      {
        keys: [' ', 'v', 'i'],
        expect: '[scoped-agents] interviewer focused',
      },
    ],
  },
  {
    name: 'import',
    why: "a on the list opens the import box; Enter on an empty box keeps it open; a request starts an import session through chat's launch and closes the box; Esc closes it with nothing started.",
    steps: [
      { keys: ['<A-h>'], expect: '[practice] list focused' },
      {
        keys: ['a'],
        expect: '[practice] import box opened',
        checksFit: true,
        screenshot: 'import-box',
      },
      { keys: ['Enter'], expect: '[practice] import refused: empty' },
      {
        keys: [...'add two sum', 'Enter'],
        expect: '[practice] import started: add two sum',
        alsoExpect: [/^\[practice\] import box closed$/],
      },
      { keys: ['a', 'Escape'], expect: '[practice] import box closed' },
    ],
  },
];

// A problem naming the missing compiler when `<compiler> --version` cannot
// run, so a failed Run step's cause shows in the report; null when it runs.
async function compilerProblem(
  deps: PracticeSelfTestDeps,
): Promise<string | null> {
  const compiler = deps.compiler();
  const runs = await deps.processes
    .run(compiler, ['--version'])
    .then((result) => result.code === 0)
    .catch(() => false);
  return runs ? null : `no ${compiler} on PATH: Run and Submit need it`;
}

// Follows the submit's write once `submitted` settles: LRU Cache's
// submissions folder holds exactly one record, and its verdict is Wrong
// Answer.
async function submissionProblem(
  deps: PracticeSelfTestDeps,
  submitted: Promise<void>,
): Promise<string | null> {
  const { files, paths } = deps;
  const folder = paths.join(
    deps.folder(),
    'problems',
    SUBMITTED_SLUG,
    'submissions',
  );
  const records = async () =>
    (await files.list(folder, { recursive: false })).filter(
      (entry) => entry.kind === 'file' && entry.path.endsWith('.json'),
    );
  await submitted;
  const isWritten = await holdsWithin(
    async () => (await records()).length > 0,
    CHECK_TIMEOUT_MS,
  );
  if (!isWritten) {
    return 'lru-cache never recorded a submission';
  }
  const written = await records();
  if (written.length !== 1) {
    return `lru-cache recorded ${String(written.length)} submissions, not 1`;
  }
  const record = JSON.parse(
    await files.read(paths.join(folder, written[0].path)),
  ) as { verdict?: unknown };
  return record.verdict === 'wrongAnswer'
    ? null
    : `lru-cache's submission verdict ${String(record.verdict)}, not wrongAnswer`;
}

// Each run rewrites the fixture in the practice folder, once the one before
// it is written, and tells the page to list again. The result lists what was
// wrong with the compiler, the fixture or the submit's write, empty when
// nothing was; it waits for the run's submit of LRU Cache before it checks the
// write.
export function practiceSelfTestScript(
  deps: PracticeSelfTestDeps,
): PracticeSelfTestScript {
  let written: Promise<unknown> = Promise.resolve();
  let heardSubmit = (): void => undefined;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: ['.practice-list .ui-row-label'],
    open() {
      const submitted = new Promise<void>((resolve) => {
        heardSubmit = resolve;
      });
      const fixture = written
        .catch(() => undefined)
        .then(() => writePracticeFixture(deps, deps.folder()));
      written = fixture;
      const result = fixture.then(
        async () => {
          deps.reload();
          const problems = await Promise.all([
            compilerProblem(deps),
            submissionProblem(deps, submitted),
          ]);
          return problems.filter((problem) => problem !== null);
        },
        (error: unknown) => [`fixture not ready: ${errorText(error)}`],
      );
      return { shownLine: '[practice] loaded 2 problems', result };
    },
    groups: practiceGroups,
    problems: (result) => result as string[],
    submitStarted(slug) {
      if (slug === SUBMITTED_SLUG) {
        heardSubmit();
      }
    },
  };
}
