import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { ProcessRunner } from '../../../contracts/processes';

export interface BacklogFixtureDeps {
  files: Files;
  processes: ProcessRunner;
  paths: Paths;
}

// The fixture's git repo and its features home, relative to the temp home.
// Docs' fixture lists the same files in the machine index.
export const BACKLOG_REPO = 'dev/backlog-repo';
export const BACKLOG_FEATURES_HOME = `${BACKLOG_REPO}/docs/features`;
export const BACKLOG_FOLLOWUPS = `${BACKLOG_FEATURES_HOME}/followups.md`;
export const FIXTURE_COMMIT_SUBJECT = 'Backlog self-test fixture';
export const FIXTURE_CHANGE_SUBJECT = 'Change the app';

// The file Moved item names, which the second commit changes.
const APP_FILE = `${BACKLOG_REPO}/src/app.ts`;

// Five follow-ups: one tagged agent-ready, one untagged, one struck through,
// one naming a path a later commit changes, and one naming a path the repo
// does not hold.
const FOLLOWUPS = `# Follow-ups — backlog-repo

**Contents**

- **Ready item** — *agent-ready*: waits for an agent
- **Plain item** — needs a look
- ~~**Shipped item**~~ — landed
- **Moved item** — reads \`src/app.ts\`
- **Stale item** — reads \`src/gone.ts\`

## Ready item

Waits for an agent.

## Plain item

Needs a look.

## ~~Shipped item~~

Landed.

## Moved item

Its code changed after it was written.

## Stale item

Its file is gone.
`;

const PLAN = `# Backlog X — plan

Target: 2026-11-30 · Written: 2026-10-20

## Tasks

- [x] [First task](01-first.md)
- [ ] [Second task](02-second.md)
`;

const FILES: readonly [string, string][] = [
  [BACKLOG_FOLLOWUPS, FOLLOWUPS],
  [`${BACKLOG_FEATURES_HOME}/backlog-x/plan-x/plan.md`, PLAN],
  [
    `${BACKLOG_FEATURES_HOME}/backlog-x/plan-x/01-first.md`,
    '# 01 — First task\n\nStatus: done\n\nThe first task.\n',
  ],
  [
    `${BACKLOG_FEATURES_HOME}/backlog-x/plan-x/02-second.md`,
    '# 02 — Second task\n\nStatus: not started\n\nThe second task.\n',
  ],
  [APP_FILE, 'export const app = 1;\n'],
];

// The author and committer dates of a commit, so the change lands a day after
// the follow-ups: staleness keeps a commit only when its committer date is
// later than the item's.
function commitDates(at: string): Record<string, string> {
  return { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
}

// The stdout of `git -C <repo> <args>`, run with `setEnv`'s names set; throws
// naming the run when it exits non-zero.
export async function runGit(
  processes: ProcessRunner,
  repo: string,
  args: string[],
  setEnv?: Readonly<Record<string, string>>,
): Promise<string> {
  const result = await processes.run('git', ['-C', repo, ...args], {
    setEnv,
  });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} exited ${String(result.code)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

// The repo's identity, no signing and no hooks, set in its own config, so
// neither the fixture's commit nor the app's reads the user's git config for
// them.
function repoConfig(repo: string, paths: Paths): [string, string][] {
  return [
    ['user.name', 'Backlog self-test'],
    ['user.email', 'backlog-selftest@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', paths.join(repo, '.git', 'no-hooks')],
  ];
}

// Writes the Backlog fixture's git repo under `homeDir` (the self-test's temp
// home), removing an earlier run's first, and makes two commits: every file on
// 2026-10-20, so its follow-ups start committed, then a change to `src/app.ts`
// on 2026-10-21, so Moved item reads as moved.
export async function writeBacklogFixture(
  deps: BacklogFixtureDeps,
  homeDir: string,
): Promise<void> {
  const { files, processes, paths } = deps;
  const home = await files.realPath(homeDir);
  const repo = paths.join(home, BACKLOG_REPO);
  if ((await files.stat(repo)) !== null) {
    await files.trash(repo);
  }
  for (const [path, text] of FILES) {
    await files.write(paths.join(home, path), text);
  }
  await runGit(processes, repo, ['init', '--quiet']);
  for (const [key, value] of repoConfig(repo, paths)) {
    await runGit(processes, repo, ['config', key, value]);
  }
  await runGit(processes, repo, ['add', '--all']);
  await runGit(
    processes,
    repo,
    ['commit', '--quiet', '-m', FIXTURE_COMMIT_SUBJECT],
    commitDates('2026-10-20T10:00:00Z'),
  );
  await files.write(paths.join(home, APP_FILE), 'export const app = 2;\n');
  await runGit(processes, repo, ['add', '--all']);
  await runGit(
    processes,
    repo,
    ['commit', '--quiet', '-m', FIXTURE_CHANGE_SUBJECT],
    commitDates('2026-10-21T10:00:00Z'),
  );
}

// Whether `homeDir` holds the Backlog fixture's repo.
export async function hasBacklogFixture(
  deps: Pick<BacklogFixtureDeps, 'files' | 'paths'>,
  homeDir: string,
): Promise<boolean> {
  return (
    (await deps.files.stat(deps.paths.join(homeDir, BACKLOG_REPO))) !== null
  );
}
