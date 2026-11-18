import { describe, expect, it, vi } from 'vitest';
import type { DemoMainStep } from '../../../contracts/demo';
import type { Git } from '../../../contracts/git';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { appUpdateStatusSlot } from '../contract';
import { demoStatus } from './demo-steps';
import { appUpdateMainPart } from './start';
import { INSTALL_POLL_MS, RESUMED_INSTALL_CAP_MS } from './updater';

const CLONE = '/Users/u/dev/wigley-ai-gui';
const INSTALLED = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ORIGIN = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const DATA = '/data/app-update';
const OLDER = '0000000cccccccccccccccccccccccccccccccc';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A clone whose origin's main is one commit past `INSTALLED`.
function aheadGit(): Git {
  return {
    fetch: vi.fn(async () => false),
    currentBranch: vi.fn(async (): Promise<string | null> => 'main'),
    resolveCommit: vi.fn(async () => ORIGIN),
    isAncestor: vi.fn(async () => true),
  } as Partial<Git> as Git;
}

// `files` are written to the data folder, as an earlier run left them, and
// the part restarted to read them. `enterDemoStep` enters the registered
// `app-update.button` step.
async function startWithBuild(
  build: { commit: string; cloneDir: string } | null,
  files: Record<string, string> = {},
) {
  const git = aheadGit();
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
  const harness = startMainPart(appUpdateMainPart, {
    services: { appBuild: build, git, demoSteps },
  });
  await settle();
  if (Object.keys(files).length > 0) {
    for (const [name, text] of Object.entries(files)) {
      await harness.files.write(`${DATA}/${name}`, text);
    }
    await harness.restart();
    for (let turn = 0; turn < 4; turn++) {
      await settle();
    }
  }
  const status = () => harness.state.read(appUpdateStatusSlot, 'test').get();
  const install = async () => {
    await harness.started().commands.install({ arg: undefined });
    await settle();
  };
  const enterDemoStep = () => {
    const step = demoSteps.list().find(({ id }) => id === 'app-update.button');
    if (step === undefined) {
      throw new Error('app-update registered no app-update.button step');
    }
    return step.enter({
      scratchDir: '/scratch',
      launchSession: () => Promise.reject(new Error('no demo session')),
      processEvents: () => {
        throw new Error('no process events');
      },
    });
  };
  return { harness, git, status, install, enterDemoStep };
}

describe('appUpdateMainPart', () => {
  it('start_BuildBehindOrigin_StatusAvailable', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });

    expect(test.git.fetch).toHaveBeenCalledWith(CLONE, expect.any(Number));
    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });
  });

  // An install that gave up after the app began quitting started nothing
  // again, so this start is the first to see its exit code; only an install
  // this build started counts.
  it.each([
    {
      case: 'this build, non-zero',
      from: INSTALLED,
      code: '1\n',
      status: { kind: 'failed', error: 'error: did not quit within 15 s' },
    },
    {
      case: 'this build, zero',
      from: INSTALLED,
      code: '0\n',
      status: { kind: 'available', sha: '2222222' },
    },
    {
      case: 'another build, non-zero',
      from: OLDER,
      code: '1\n',
      status: { kind: 'available', sha: '2222222' },
    },
    {
      case: 'no from-commit, non-zero',
      from: '',
      code: '1\n',
      status: { kind: 'available', sha: '2222222' },
    },
  ])(
    'start_EarlierInstallExitCode_Status ($case)',
    async ({ from, code, status }) => {
      const test = await startWithBuild(
        { commit: INSTALLED, cloneDir: CLONE },
        {
          'install-from-commit': from,
          'install-exit-code': code,
          'install.log': 'error: did not quit within 15 s\n',
        },
      );

      expect(test.status()).toEqual(status);
    },
  );

  // A failed swap starts this build again before the install's shell writes
  // its code.
  it('start_EarlierInstallNoCodeYet_PollsItToFailed', async () => {
    const test = await startWithBuild(
      { commit: INSTALLED, cloneDir: CLONE },
      { 'install-from-commit': INSTALLED, 'install-exit-code': '' },
    );
    expect(test.status()).toEqual({ kind: 'installing' });

    await test.harness.files.write(`${DATA}/install-exit-code`, '1\n');
    test.harness.advance(INSTALL_POLL_MS);
    await settle();

    expect(test.status()).toEqual({
      kind: 'failed',
      error: 'install-app exited 1',
    });
  });

  it('start_EarlierInstallNoCodeWithinTheCap_Dropped', async () => {
    const test = await startWithBuild(
      { commit: INSTALLED, cloneDir: CLONE },
      { 'install-from-commit': INSTALLED, 'install-exit-code': '' },
    );

    for (
      let polls = 0;
      polls * INSTALL_POLL_MS <= RESUMED_INSTALL_CAP_MS;
      polls++
    ) {
      test.harness.advance(INSTALL_POLL_MS);
      await settle();
    }
    await settle();

    expect(test.harness.logs.map(({ message }) => message)).toContain(
      'earlier install gave no exit code within 120 s: dropped',
    );
    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });
  });

  it('start_NoBuild_ChecksNothingAndInstallSkips', async () => {
    const test = await startWithBuild(null);
    await test.install();

    expect(test.git.fetch).not.toHaveBeenCalled();
    expect(test.status()).toEqual({ kind: 'none' });
    expect(test.harness.processes.detachedStarts).toEqual([]);
    expect(test.harness.logs.map(({ message }) => message)).toContain(
      'install skipped: no build baked in',
    );
  });

  it('install_Available_StartsTheInstallDetachedInTheClone', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });

    await test.install();

    expect(test.status()).toEqual({ kind: 'installing' });
    expect(test.harness.processes.detachedStarts).toEqual([
      {
        command: '/bin/zsh',
        args: [
          '-lc',
          `source ~/.nvm/nvm.sh && nvm use && npm run install-app -- --ref origin/main; echo $? > '${DATA}/install-exit-code'`,
        ],
        options: { cwd: CLONE, logPath: `${DATA}/install.log` },
      },
    ]);
  });

  it.each([
    {
      case: 'non-zero',
      code: '1\n',
      status: { kind: 'failed', error: 'step one\nerror: the build broke' },
    },
    // The app still runs its old build, so the check that follows finds the update again.
    {
      case: 'zero',
      code: '0\n',
      status: { kind: 'available', sha: '2222222' },
    },
  ])(
    'a written exit code sets the install result ($case)',
    async ({ code, status }) => {
      const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
      await test.install();
      test.harness.advance(INSTALL_POLL_MS);
      await settle();
      expect(test.status()).toEqual({ kind: 'installing' });

      await test.harness.files.write(
        `${DATA}/install.log`,
        'step one\n\nerror: the build broke\n',
      );
      await test.harness.files.write(`${DATA}/install-exit-code`, code);
      test.harness.advance(INSTALL_POLL_MS);
      await settle();
      await settle();

      expect(test.status()).toEqual(status);
    },
  );

  it.each([
    { branch: 'main', warning: null },
    {
      branch: 'feature',
      warning:
        'warning: the clone is on feature, not main; the install runs its install-app',
    },
  ])(
    'install_CloneOnBranch_WarnsOffMain ($branch)',
    async ({ branch, warning }) => {
      const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
      vi.mocked(test.git.currentBranch).mockResolvedValue(branch);

      await test.install();

      const warnings = test.harness.logs
        .map(({ message }) => message)
        .filter((message) => message.startsWith('warning: the clone is on'));
      expect(warnings).toEqual(warning === null ? [] : [warning]);
      expect(test.harness.processes.detachedStarts).toHaveLength(1);
    },
  );

  it('install_ProgramCannotStart_FailedWithTheError', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    test.harness.processes.failDetachedStarts(
      new Error('Could not run /bin/zsh: spawn ENOENT'),
    );

    await test.install();

    expect(test.status()).toEqual({
      kind: 'failed',
      error: 'Could not run /bin/zsh: spawn ENOENT',
    });
  });

  it('install_WhileInstalling_StartsNothingMore', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.install();

    await test.install();

    expect(test.harness.processes.detachedStarts).toHaveLength(1);
  });

  it('stop_WhileInstalling_LeavesTheStatusForTheNextStart', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.install();

    await test.harness.restart();
    await settle();

    expect(test.status()).toEqual({ kind: 'installing' });
  });

  it('install_StaleExitCodeBefore_StillInstallingAfterAPoll', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.harness.files.write(`${DATA}/install-exit-code`, '1\n');

    await test.install();
    test.harness.advance(INSTALL_POLL_MS);
    await settle();

    expect(test.status()).toEqual({ kind: 'installing' });
  });

  it('install_FromFailed_StartsAgain', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.install();
    await test.harness.files.write(`${DATA}/install-exit-code`, '1\n');
    test.harness.advance(INSTALL_POLL_MS);
    await settle();
    expect(test.status()).toMatchObject({ kind: 'failed' });

    await test.install();

    expect(test.status()).toEqual({ kind: 'installing' });
    expect(test.harness.processes.detachedStarts).toHaveLength(2);
  });

  it('restart_WhileInstalling_PollsTheExitCodeAgain', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.install();
    await test.harness.restart();
    await settle();

    await test.harness.files.write(`${DATA}/install-exit-code`, '1\n');
    test.harness.advance(INSTALL_POLL_MS);
    await settle();

    expect(test.status()).toEqual({
      kind: 'failed',
      error: 'install-app exited 1',
    });
  });

  it('demoStep_InstallStartsNothing_AndLeavingShowsTheRealStatus', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    const stage = await test.enterDemoStep();
    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });

    await test.install();
    expect(test.harness.processes.detachedStarts).toEqual([]);
    expect(test.status()).toEqual({ kind: 'installing' });

    stage.dispose();
    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });
  });

  it('demoStep_StopMidStep_NextStartReadsTheRealStatus', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    await test.enterDemoStep();
    await test.install();

    await test.harness.restart();
    await settle();

    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });
    expect(test.harness.processes.detachedStarts).toEqual([]);
  });

  // Breaks: a stage left after a restart writing its part's real status over
  // the new part's sample.
  it('demoStep_LeftAfterARestart_LeavesTheNewStagesStatus', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });
    const stale = await test.enterDemoStep();
    await test.harness.restart();
    await settle();
    await test.enterDemoStep();
    test.harness.invoke('showDemoStatus', 'failed');

    stale.dispose();

    expect(test.status()).toEqual(demoStatus('failed'));
  });

  it('showDemoStatus_NoStageEntered_Throws', async () => {
    const test = await startWithBuild({ commit: INSTALLED, cloneDir: CLONE });

    expect(() => test.harness.invoke('showDemoStatus', 'failed')).toThrow(
      'no demo step entered',
    );
    expect(test.status()).toEqual({ kind: 'available', sha: '2222222' });
  });
});
