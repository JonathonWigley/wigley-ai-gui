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

// Three follow-ups: one tagged agent-ready, one untagged, one struck through.
const FOLLOWUPS = `# Follow-ups — backlog-repo

**Contents**

- **Ready item** — *agent-ready*: waits for an agent
- **Plain item** — needs a look
- ~~**Shipped item**~~ — landed

## Ready item

Waits for an agent.

## Plain item

Needs a look.

## ~~Shipped item~~

Landed.
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
];

// The stdout of `git -C <repo> <args>`; throws naming the run when it exits
// non-zero.
export async function runGit(
  processes: ProcessRunner,
  repo: string,
  args: string[],
): Promise<string> {
  const result = await processes.run('git', ['-C', repo, ...args]);
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
// home), removing an earlier run's first, and commits its files, so its
// follow-ups start committed.
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
  await runGit(processes, repo, [
    'commit',
    '--quiet',
    '-m',
    FIXTURE_COMMIT_SUBJECT,
  ]);
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
