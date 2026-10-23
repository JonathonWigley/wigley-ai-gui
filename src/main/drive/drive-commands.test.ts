import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
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
// whose config changes whenever a file under the home is written, and whose
// run log goes to `logged`; `answers` come ahead of a ready page's.
function setUp(log: () => string[], answers: FakeAnswer[] = []) {
  const fake = fakeDrivenWindow([...answers, ...READY_PAGE, ['#log li', log]]);
  const files = createMemoryFiles();
  const configListeners = new Set<() => void>();
  const logged: string[] = [];
  const commands = createDriveCommands({
    window: fake.window,
    actions: createActionRegistry(),
    homeFiles: scopedFiles(files, HOME, posixPaths),
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
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  const changeConfigOnWrite = () =>
    files.watch(HOME, () => {
      for (const listener of configListeners) {
        listener();
      }
    });
  return { fake, files, commands, changeConfigOnWrite, logged };
}

// A press target whose centre is at (60, 40), shown and uncovered.
const TARGET_AT_60X40: FakeAnswer = [
  'elementFromPoint',
  () => ({ x: 60, y: 40, isShown: true, isInWindow: true, cover: null }),
];

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

  it('run_AnotherDebuggerHoldsThePage_RunsTheCommandAndLogsWhyFocusIsNotEmulated', async () => {
    const { fake, commands, logged } = setUp(() => []);
    fake.focused.failure = new Error('Another debugger is already attached');

    const result = await commands.run('ready', {});

    expect(result).toEqual({ ready: true });
    expect(logged).toEqual([
      '[main] drive: focus could not be emulated, so the page runs unfocused: Another debugger is already attached',
    ]);
  });

  it('waitLog_MatchingLineLoggedBeforeTheCall_ResolvesNotFound', async () => {
    const { commands } = setUp(() => ['[a] done']);

    const result = await commands.run('wait-log', {
      line: '[a] done',
      timeoutMs: 100,
    });

    expect(result).toEqual({ found: false });
  });

  it('waitLog_MatchingLineLoggedAfterTheCall_ResolvesFound', async () => {
    let reads = 0;
    const { commands } = setUp(() => {
      reads += 1;
      return reads <= 1 ? ['[a] done'] : ['[a] done', '[a] done'];
    });

    const result = await commands.run('wait-log', { line: '[a] done' });

    expect(result).toEqual({ found: true });
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

  it('drag_WithHold_EndsOnAHeldMoveAndSendsNoMouseUp', async () => {
    const { fake, commands } = setUp(() => [], [TARGET_AT_60X40]);

    await commands.run('drag', {
      selector: '.handle',
      dx: 40,
      dy: 0,
      hold: true,
    });

    expect(fake.inputs.at(-1)).toMatchObject({
      type: 'mouseMove',
      x: 100,
      y: 40,
      modifiers: ['leftbuttondown'],
    });
    expect(fake.inputs.some((input) => input.type === 'mouseUp')).toBe(false);
  });

  it('release_AfterAHeldDrag_SendsOneMouseUpAtTheEndPointAndReturnsItsLines', async () => {
    const { fake, commands } = setUp(
      () =>
        fake.inputs.some((input) => input.type === 'mouseUp')
          ? ['[x] dropped', '[a] before']
          : ['[a] before'],
      [TARGET_AT_60X40],
    );
    await commands.run('drag', {
      selector: '.handle',
      dx: 40,
      dy: 0,
      hold: true,
    });
    const sentBefore = fake.inputs.length;

    const result = await commands.run('release', {});

    expect(fake.inputs.slice(sentBefore)).toEqual([
      expect.objectContaining({
        type: 'mouseUp',
        button: 'left',
        x: 100,
        y: 40,
        modifiers: [],
      }),
    ]);
    expect(result).toEqual({ lines: ['[x] dropped'] });
  });

  it('clickOrDrag_WhileADragIsHeld_RejectsNamingTheHeldSelectorAndSendsNothing', async () => {
    const { fake, commands } = setUp(() => [], [TARGET_AT_60X40]);
    await commands.run('drag', {
      selector: '.handle',
      dx: 40,
      dy: 0,
      hold: true,
    });
    const sentBefore = fake.inputs.length;

    await expect(
      commands.run('click', { selector: '.button' }),
    ).rejects.toThrow('A drag from .handle is held; release it first');
    await expect(
      commands.run('drag', { selector: '.other', dx: 10, dy: 0 }),
    ).rejects.toThrow('A drag from .handle is held; release it first');
    expect(fake.inputs).toHaveLength(sentBefore);
  });

  it('release_NoDragHeld_RejectsSayingToDragWithHoldFirst', async () => {
    const { fake, commands } = setUp(() => []);

    await expect(commands.run('release', {})).rejects.toThrow(
      'No drag is held; drag --hold first',
    );
    expect(fake.inputs).toEqual([]);
  });

  it('screenshot_MatchHasNoSize_RejectsSayingItIsNotShown', async () => {
    const { commands } = setUp(
      () => [],
      [['querySelector(', () => ({ x: 10, y: 20, width: 0, height: 0 })]],
    );

    await expect(
      commands.run('screenshot', { name: 'empty', selector: '.hidden' }),
    ).rejects.toThrow('.hidden has no size: it is not shown');
  });

  it('record_StartNameLeavesTheVideosFolder_RejectsAndRecordsNothing', async () => {
    const { commands } = setUp(() => []);

    await expect(
      commands.run('record', { action: 'start', name: '../escape' }),
    ).rejects.toThrow(
      'Recording name "../escape" is not lowercase letters and digits in words joined by -',
    );
    await expect(commands.run('record', { action: 'stop' })).rejects.toThrow(
      'Not recording',
    );
  });
});
