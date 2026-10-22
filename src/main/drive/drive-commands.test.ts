import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { scopedFiles } from '../../shared/scoped-files';
import { createActionRegistry } from './action-registry';
import { createDriveCommands } from './drive-commands';
import { type FakeAnswer, fakeDrivenWindow } from './fake-driven-window';
import { createFrameRecorder } from './frame-recorder';
import { STEP_TIMEOUT_MS } from './page-driver';

const HOME = '/run/home';
const SETTINGS = `${HOME}/.config/wigley-ai-gui/settings.json`;

// The answers a ready page gives the drive's waits: ready for keys, no start
// failure, and three frames drawn at once.
const READY_PAGE: FakeAnswer[] = [
  ['dataset.ready', () => true],
  ['dataset.startFailed', () => null],
  ['window.redrawFrames = 0', () => undefined],
  ['window.redrawFrames', () => 3],
];

// Commands over a fake window whose page log `log` gives, newest first, and
// whose config changes whenever a file under the home is written; `answers`
// come ahead of a ready page's.
function setUp(log: () => string[], answers: FakeAnswer[] = []) {
  const fake = fakeDrivenWindow([...answers, ...READY_PAGE, ['#log li', log]]);
  const files = createMemoryFiles();
  const configListeners = new Set<() => void>();
  const commands = createDriveCommands({
    window: fake.window,
    actions: createActionRegistry(),
    homeFiles: scopedFiles(files, HOME),
    runDir: '/run',
    files,
    recorder: createFrameRecorder({
      window: fake.window,
      files,
      processes: new FakeProcesses(),
      runDir: '/run',
    }),
    configChanged: (listener) => {
      configListeners.add(listener);
      return { dispose: () => configListeners.delete(listener) };
    },
    quit: () => {},
  });
  const changeConfigOnWrite = () =>
    files.watch(HOME, () => {
      for (const listener of configListeners) {
        listener();
      }
    });
  return { fake, files, commands, changeConfigOnWrite };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createDriveCommands', () => {
  it('key_LogGainsTwoLinesAfterTheKey_ReturnsBothOldestFirst', async () => {
    const { fake, commands } = setUp(() =>
      fake.inputs.length === 0
        ? ['[a] before']
        : ['[x] second', '[x] first', '[a] before'],
    );

    const result = await commands.run('key', { keys: ['j'] });

    expect(result).toEqual({ lines: ['[x] first', '[x] second'] });
  });

  it('setting_PluginSettingAndTheConfigChanges_KeepsBothSettingsAndIsApplied', async () => {
    const { files, commands, changeConfigOnWrite } = setUp(() => []);
    await files.write(SETTINGS, '{ "transparency": "full" }');
    changeConfigOnWrite();

    const result = await commands.run('setting', {
      plugin: 'keys',
      name: 'whichKeyTimeoutMs',
      value: 50,
    });

    expect(JSON.parse(await files.read(SETTINGS))).toEqual({
      transparency: 'full',
      keys: { whichKeyTimeoutMs: 50 },
    });
    expect(result).toEqual({ lines: [], applied: true });
  });

  it('setting_ConfigNeverChanges_ResolvesNotAppliedAfterTheStepTimeout', async () => {
    vi.useFakeTimers();
    const { commands } = setUp(() => []);

    const result = commands.run('setting', { name: 'transparency', value: 1 });
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS);

    expect(await result).toEqual({ lines: [], applied: false });
  });

  it('log_PageLogShorterThanSince_ReturnsEveryLineAsReloaded', async () => {
    const { commands } = setUp(() => ['[a] second', '[a] first']);

    const result = await commands.run('log', { since: 5 });

    expect(result).toEqual({
      lines: ['[a] first', '[a] second'],
      next: 2,
      reloaded: true,
    });
  });

  it('key_EmptyKeyList_RejectsNamingTheSpaceKeySpelling', async () => {
    const { fake, commands } = setUp(() => []);

    await expect(commands.run('key', { keys: [] })).rejects.toThrow(
      'the CLI spells Space',
    );
    expect(fake.inputs).toEqual([]);
  });

  it('run_AnyCommandButQuit_EmulatesFocusFirst', async () => {
    const { fake, commands } = setUp(() => []);

    await commands.run('ready', {});
    await commands.run('quit', {});

    expect(fake.focused.emulated).toBe(1);
  });

  it('ready_PageNeverAnswers_RejectsSayingItNeverFinishedLoading', async () => {
    vi.useFakeTimers();
    const { commands } = setUp(
      () => [],
      [['dataset.ready', () => new Promise(() => {})]],
    );

    const result = commands.run('ready', {});
    const rejected = expect(result).rejects.toThrow(
      'The page never finished loading',
    );
    await vi.advanceTimersByTimeAsync(30_000);

    await rejected;
  });

  it('click_NoElementMatches_RejectsNamingTheSelector', async () => {
    const { commands } = setUp(() => [], [['querySelector(', () => null]]);

    await expect(
      commands.run('click', { selector: '.missing' }),
    ).rejects.toThrow('No element matches .missing');
  });
});
