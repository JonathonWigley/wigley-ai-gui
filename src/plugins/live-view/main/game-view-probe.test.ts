import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../contracts/processes';
import { FakeProcesses } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { PROBE_ATTEMPTS, probeGameRect } from './game-view-probe';

const PROJECT = '/home/Game';
const SCRIPT = '/plugins/wigley/skills/unity-playtest/unity/WigleyCapture.cs';
const RECT = [512, 140, 360, 640];
const PROBE_ARGS = JSON.stringify([JSON.stringify({ action: 'probe' })]);
const SCRIPT_CALL = [
  '--file',
  SCRIPT,
  '--entry',
  'Wigley.WigleyCapture.Run',
  '--args',
  PROBE_ARGS,
];
const PROJECT_TAIL = ['--json', '--project-path', PROJECT];
const GROUPED_ARGS = [
  'command',
  'script',
  'run',
  ...SCRIPT_CALL,
  '--timeout',
  '8',
  ...PROJECT_TAIL,
];
const LEGACY_ARGS = [
  'command',
  'run_script',
  ...SCRIPT_CALL,
  '--timeout_ms',
  '8000',
  '--timeout',
  '23',
  ...PROJECT_TAIL,
];

function ran(stdout: string, code = 0): ProcessResult {
  return { code, stdout, stderr: '', timedOut: false };
}

// The script's own reply, as `script run --json` prints it: a JSON string
// under `result`.
function grouped(reply: object): ProcessResult {
  return ran(
    JSON.stringify({ result: JSON.stringify(reply), diagnostics: [] }),
  );
}

const PLAYING = { ok: true, playing: true, window: RECT };
const NOT_PLAYING = { ok: true, playing: false, window: RECT };
const NO_WINDOW = { ok: true, playing: true, window: null };

// The probe over a project whose manifest is `manifest` (none when null), each
// run answering the next of `results` and the last again once they run out.
async function setUp({
  manifest = null,
  results = [grouped(PLAYING)],
  script = SCRIPT,
  unity = true,
}: {
  manifest?: string | null;
  results?: (ProcessResult | Error)[];
  script?: string | null;
  unity?: boolean;
} = {}) {
  const files = createMemoryFiles();
  if (manifest !== null) {
    await files.write(`${PROJECT}/Packages/manifest.json`, manifest);
  }
  const processes = new FakeProcesses();
  processes.scriptProgram(
    'unity',
    unity ? { command: '/bin/unity', args: [] } : null,
  );
  const runs: string[][] = [];
  processes.run = (_command, args) => {
    runs.push(args);
    const result = results[Math.min(runs.length, results.length) - 1]!;
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  const waits: number[] = [];
  const deps = {
    processes,
    files,
    paths: posixPaths,
    locateScript: () => Promise.resolve(script),
    wait: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
  return { deps, runs, waits };
}

describe('probeGameRect', () => {
  it.each<{ given: string; manifest: string | null; args: string[] }>([
    { given: 'no manifest', manifest: null, args: GROUPED_ARGS },
    {
      given: 'a 0.9 pin',
      manifest: '{"dependencies":{"com.unity.pipeline":"0.9.1"}}',
      args: GROUPED_ARGS,
    },
    {
      given: 'a 1.2 pin',
      manifest: '{"dependencies":{"com.unity.pipeline":"1.2.0"}}',
      args: GROUPED_ARGS,
    },
    {
      given: 'a 0.8 pin',
      manifest: '{"dependencies":{"com.unity.pipeline":"0.8.0-exp.1"}}',
      args: LEGACY_ARGS,
    },
    {
      given: 'a manifest that does not parse',
      manifest: 'not json',
      args: GROUPED_ARGS,
    },
  ])(
    'calls the probe by the names the pipeline pin takes, given $given',
    async ({ manifest, args }) => {
      const { deps, runs } = await setUp({ manifest });

      await probeGameRect(deps, PROJECT, () => false);

      expect(runs).toEqual([args]);
    },
  );

  it.each<{ given: string; result: ProcessResult; expected: unknown }>([
    {
      given: "script run's JSON string under result",
      result: grouped(PLAYING),
      expected: { rect: RECT },
    },
    {
      given: 'the reply bare',
      result: ran(JSON.stringify(PLAYING)),
      expected: { rect: RECT },
    },
    {
      given: "an old pin's envelope",
      result: ran(
        JSON.stringify({
          success: true,
          data: { result: { success: true, result: JSON.stringify(PLAYING) } },
          errors: [],
        }),
      ),
      expected: { rect: RECT },
    },
    {
      given: 'a script reply that is not ok',
      result: grouped({ ok: false, error: 'GameView missing' }),
      expected: { error: 'the probe failed: GameView missing' },
    },
    {
      given: 'a compile failure',
      result: ran(
        JSON.stringify({ result: { success: false, error: 'CS0246' } }),
      ),
      expected: { error: 'the probe failed: CS0246' },
    },
    {
      given: 'a non-zero exit',
      result: { code: 3, stdout: '', stderr: 'no editor', timedOut: false },
      expected: { error: 'unity script run exited 3: no editor' },
    },
    {
      given: 'a timeout',
      result: { code: -1, stdout: '', stderr: '', timedOut: true },
      expected: { error: 'unity script run timed out' },
    },
    {
      given: 'stdout that is not JSON',
      result: ran('Compiling...'),
      expected: { error: "the probe's reply is not JSON: Compiling..." },
    },
    {
      given: 'a window of zero width',
      result: grouped({ ok: true, playing: true, window: [1, 2, 0, 4] }),
      expected: { error: 'the editor has no Game View open' },
    },
  ])(
    'reads the Game View rect out of the reply, given $given',
    async ({ result, expected }) => {
      const { deps } = await setUp({ results: [result] });

      expect(await probeGameRect(deps, PROJECT, () => false)).toEqual(expected);
    },
  );

  it.each<{
    given: string;
    results: ProcessResult[];
    expected: unknown;
    runs: number;
  }>([
    {
      given: 'playing at once',
      results: [grouped(PLAYING)],
      expected: { rect: RECT },
      runs: 1,
    },
    {
      given: 'playing on the second call',
      results: [
        grouped(NOT_PLAYING),
        grouped({ ...PLAYING, window: [1, 2, 3, 4] }),
      ],
      expected: { rect: [1, 2, 3, 4] },
      runs: 2,
    },
    {
      given: 'a failed call, then playing',
      results: [ran('', 1), grouped(PLAYING)],
      expected: { rect: RECT },
      runs: 2,
    },
    {
      given: 'never playing',
      results: [grouped(NOT_PLAYING)],
      expected: { rect: RECT },
      runs: PROBE_ATTEMPTS,
    },
    {
      given: 'never a window',
      results: [grouped(NO_WINDOW)],
      expected: { error: 'the editor has no Game View open' },
      runs: PROBE_ATTEMPTS,
    },
  ])(
    'tries again until the editor plays with a Game View, given $given',
    async ({ results, expected, runs }) => {
      const { deps, runs: made, waits } = await setUp({ results });

      const result = await probeGameRect(deps, PROJECT, () => false);

      expect(result).toEqual(expected);
      expect(made).toHaveLength(runs);
      expect(waits).toHaveLength(runs - 1);
    },
  );

  it('stops trying once cancelled', async () => {
    const { deps, runs } = await setUp({ results: [grouped(NOT_PLAYING)] });
    let isCancelled = false;
    deps.wait = () => {
      isCancelled = true;
      return Promise.resolve();
    };

    const result = await probeGameRect(deps, PROJECT, () => isCancelled);

    expect(result).toEqual({ error: 'the playtest show was interrupted' });
    expect(runs).toHaveLength(1);
  });

  it.each<{
    given: string;
    script: string | null;
    unity: boolean;
    error: string;
  }>([
    {
      given: 'no wigley install holding the script',
      script: null,
      unity: true,
      error: 'no wigley install holds WigleyCapture.cs',
    },
    {
      given: 'no unity CLI',
      script: SCRIPT,
      unity: false,
      error: 'unity was not found on PATH or in ~/.unity/bin',
    },
  ])('runs nothing, given $given', async ({ script, unity, error }) => {
    const { deps, runs } = await setUp({ script, unity });

    expect(await probeGameRect(deps, PROJECT, () => false)).toEqual({ error });
    expect(runs).toEqual([]);
  });

  it('answers a run that rejects with its error', async () => {
    const { deps } = await setUp({
      results: [new Error('Could not run unity')],
    });

    expect(await probeGameRect(deps, PROJECT, () => false)).toEqual({
      error: 'Could not run unity',
    });
  });
});
