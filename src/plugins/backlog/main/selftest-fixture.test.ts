import { describe, expect, it } from 'vitest';
import { FakeProcesses } from '../../../shared/fake-processes';
import { parseFollowups } from '../../../shared/followups/followup-file';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { writeBacklogFixture } from './selftest-fixture';

const HOME = '/home';
const REPO = `${HOME}/dev/backlog-repo`;
const FOLLOWUPS = `${REPO}/docs/features/followups.md`;
const OK = { code: 0, stdout: '', stderr: '', timedOut: false };

const GIT_RUNS: string[][] = [
  ['init', '--quiet'],
  ['config', 'user.name', 'Backlog self-test'],
  ['config', 'user.email', 'backlog-selftest@example.invalid'],
  ['config', 'commit.gpgsign', 'false'],
  ['config', 'core.hooksPath', `${REPO}/.git/no-hooks`],
  ['add', '--all'],
  ['commit', '--quiet', '-m', 'Backlog self-test fixture'],
];

async function fixtureDeps() {
  const files = createMemoryFiles();
  await files.makeFolder(HOME);
  const processes = new FakeProcesses();
  for (const args of GIT_RUNS) {
    processes.script('git', ['-C', REPO, ...args], OK);
  }
  return { files, processes, paths: posixPaths };
}

describe('writeBacklogFixture', () => {
  it('GIVEN an empty home WHEN the fixture is written THEN its follow-ups hold one agent-ready, one untagged and one done item', async () => {
    const deps = await fixtureDeps();

    await writeBacklogFixture(deps, HOME);

    const items = parseFollowups(await deps.files.read(FOLLOWUPS)).items;
    expect(
      items.map(({ title, tags, done }) => ({ title, tags, done })),
    ).toEqual([
      { title: 'Ready item', tags: ['agent-ready'], done: false },
      { title: 'Plain item', tags: [], done: false },
      { title: 'Shipped item', tags: [], done: true },
    ]);
  });

  it('GIVEN an empty home WHEN the fixture is written THEN git inits, sets its own identity, no signing and no hooks, then commits every file', async () => {
    const deps = await fixtureDeps();

    await writeBacklogFixture(deps, HOME);

    expect(deps.processes.runs.map((run) => run.args)).toEqual(
      GIT_RUNS.map((args) => ['-C', REPO, ...args]),
    );
  });

  it('GIVEN an earlier run left a file in the repo WHEN the fixture is written again THEN the file is gone', async () => {
    const deps = await fixtureDeps();
    await writeBacklogFixture(deps, HOME);
    await deps.files.write(`${REPO}/docs/features/stray.md`, '# Stray\n');

    await writeBacklogFixture(deps, HOME);

    expect(await deps.files.stat(`${REPO}/docs/features/stray.md`)).toBeNull();
  });

  it('GIVEN git exits non-zero WHEN the fixture is written THEN it rejects naming the git run', async () => {
    const deps = await fixtureDeps();
    deps.processes.script('git', ['-C', REPO, 'add', '--all'], {
      ...OK,
      code: 128,
      stderr: 'fatal: broken',
    });

    await expect(writeBacklogFixture(deps, HOME)).rejects.toThrow(
      'git add --all exited 128: fatal: broken',
    );
  });
});
