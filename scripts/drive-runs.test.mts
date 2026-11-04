import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hostChildrenFile,
  hostRecordFile,
} from '../src/contracts/session-host-protocol.ts';
import {
  hostMayBeRunning,
  idleRunIds,
  quitRefusal,
  RUN_IDLE_MS,
  type RunFolder,
  type StartOptions,
  startPlanOf,
  startRefusal,
} from './drive-runs.mts';

const NOW = 1_000_000_000_000;

describe('idleRunIds', () => {
  it.each<[string, boolean, Partial<RunFolder>, string]>([
    ['idle past the limit with no live app', true, {}, 'other'],
    [
      'used within the limit',
      false,
      { lastUsedMs: NOW - RUN_IDLE_MS + 1 },
      'other',
    ],
    ['exactly at the limit', false, { lastUsedMs: NOW - RUN_IDLE_MS }, 'other'],
    ['idle but its app is live', false, { isLive: true }, 'other'],
    ['idle but the run being started', false, {}, 'old'],
  ])(
    'GIVEN a run %s WHEN a start sweeps THEN its deletion is %s',
    (_, isDeleted, overrides, startingRun) => {
      const run: RunFolder = {
        id: 'old',
        lastUsedMs: NOW - RUN_IDLE_MS - 1,
        isLive: false,
        ...overrides,
      };

      expect(idleRunIds([run], startingRun, NOW)).toEqual(
        isDeleted ? ['old'] : [],
      );
    },
  );
});

describe('startPlanOf', () => {
  const RECORDED: StartOptions = {
    packaged: true,
    harness: 'claude',
    userConfig: true,
  };
  const DEFAULTS: StartOptions = {
    packaged: false,
    harness: 'fake',
    userConfig: false,
  };
  const NAMED: StartOptions = {
    packaged: false,
    harness: 'fake',
    userConfig: true,
  };

  it.each<{
    name: string;
    named: StartOptions & { namesFlags: boolean };
    kept: StartOptions | null;
    options: StartOptions;
    copiesUserConfig: boolean;
  }>([
    {
      name: 'a kept run naming no flag takes what it recorded, copying nothing',
      named: { ...DEFAULTS, namesFlags: false },
      kept: RECORDED,
      options: RECORDED,
      copiesUserConfig: false,
    },
    {
      name: 'a kept run naming a flag takes its command line, copying nothing',
      named: { ...NAMED, namesFlags: true },
      kept: RECORDED,
      options: NAMED,
      copiesUserConfig: false,
    },
    {
      name: 'a run with no kept home takes its command line and copies',
      named: { ...NAMED, namesFlags: true },
      kept: null,
      options: NAMED,
      copiesUserConfig: true,
    },
    {
      name: 'a run with no kept home naming no flag takes the defaults',
      named: { ...DEFAULTS, namesFlags: false },
      kept: null,
      options: DEFAULTS,
      copiesUserConfig: true,
    },
  ])('$name', ({ named, kept, options, copiesUserConfig }) => {
    expect(startPlanOf(named, kept)).toEqual({ options, copiesUserConfig });
  });
});

describe('startRefusal', () => {
  it('GIVEN a recorded app pid still alive WHEN starting THEN it refuses naming the pids', () => {
    const refusal = startRefusal('r1', [41531, 41540]);

    expect(refusal).toContain('r1');
    expect(refusal).toContain('41531 41540');
  });

  it('GIVEN no recorded app alive WHEN starting THEN it goes ahead', () => {
    expect(startRefusal('r1', [])).toBeNull();
  });
});

describe('quitRefusal', () => {
  it.each<[string, readonly number[], boolean, boolean]>([
    ['no app and a host running', [], true, true],
    ['no app and no host', [], false, false],
    ['a live app ending its own host', [41531], true, false],
    ['a live app and no host', [41531], false, false],
  ])(
    'GIVEN %s WHEN plain quit asks THEN refusal is %s',
    (_, liveAppPids, hostRuns, refuses) => {
      const refusal = quitRefusal('r1', {
        liveAppPids,
        hostMayBeRunning: hostRuns,
      });

      if (refuses) {
        expect(refusal).toContain('start --run r1');
      } else {
        expect(refusal).toBeNull();
      }
    },
  );
});

describe('hostMayBeRunning', () => {
  const folders: string[] = [];
  const servers: Server[] = [];

  const newRunDir = () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'drive-runs-'));
    folders.push(runDir);
    return runDir;
  };

  const channelIn = (folder: string) =>
    process.platform === 'win32'
      ? `\\\\.\\pipe\\${path.basename(folder)}`
      : path.join(folder, 's.sock');

  const listenOn = (channel: string) =>
    new Promise<void>((listening) => {
      const server = createServer();
      servers.push(server);
      server.listen(channel, listening);
    });

  const writeRecord = (runDir: string, protocol: number, channel: string) => {
    const hostFolder = path.join(runDir, 'user-data', 'session-host');
    mkdirSync(hostFolder, { recursive: true });
    writeFileSync(
      path.join(hostFolder, hostRecordFile(protocol)),
      JSON.stringify({ protocol, channel, pid: 1 }),
    );
    return hostFolder;
  };

  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise((closed) => server.close(closed))),
    );
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('GIVEN a run whose folder has no host folder THEN no host runs', async () => {
    expect(await hostMayBeRunning(newRunDir())).toBe(false);
  });

  it('GIVEN a host folder with only a children record THEN no host runs', async () => {
    const runDir = newRunDir();
    const hostFolder = writeRecord(runDir, 1, channelIn(runDir));
    rmSync(path.join(hostFolder, hostRecordFile(1)));
    writeFileSync(path.join(hostFolder, hostChildrenFile(1, 7)), '{}');

    expect(await hostMayBeRunning(runDir)).toBe(false);
  });

  it('GIVEN a record whose channel has no listener THEN no host runs', async () => {
    const runDir = newRunDir();
    writeRecord(runDir, 1, channelIn(runDir));

    expect(await hostMayBeRunning(runDir)).toBe(false);
  });

  it('GIVEN a dead record beside one that listens THEN a host runs', async () => {
    const runDir = newRunDir();
    const channel = channelIn(runDir);
    await listenOn(channel);
    writeRecord(runDir, 1, `${channel}-gone`);
    writeRecord(runDir, 2, channel);

    expect(await hostMayBeRunning(runDir)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'GIVEN a record whose connect is denied THEN a host may run',
    async () => {
      const runDir = newRunDir();
      const denied = path.join(runDir, 'denied');
      mkdirSync(denied);
      const channel = path.join(denied, 's.sock');
      await listenOn(channel);
      writeRecord(runDir, 1, channel);
      chmodSync(denied, 0o000);

      try {
        expect(await hostMayBeRunning(runDir)).toBe(true);
      } finally {
        chmodSync(denied, 0o700);
      }
    },
  );
});
