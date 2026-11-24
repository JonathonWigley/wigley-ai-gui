import { describe, expect, it } from 'vitest';
import buildQueue from './fixtures/build-queue.json';
import chainFailed from './fixtures/chain-failed.json';
import chainFinished from './fixtures/chain-finished.json';
import chainRunning from './fixtures/chain-running.json';
import deployAndroidLog from './fixtures/deploy-android.log?raw';
import deployIosLog from './fixtures/deploy-ios.log?raw';
import runListDev from './fixtures/run-list-dev.json';
import {
  parseBuildNumber,
  parseBuildQueue,
  parseChainDetail,
  parseRunList,
  parseTeamcityDate,
  readFirebaseLinks,
} from './teamcity-parse';

// The recorded shas: the game's repo, and an older commit of it.
const A = '2993a9e4b92724916453c6e2a3257c4838ce0777';
const F = '5e1f4c2a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f';
const IOS_URL =
  'https://appdistribution.firebase.google.com/testerapps/1:1017210896283:ios:26dc2b5eea26c5c6eceb3e/releases/3433pjvova820?utm_source=firebase-tools';
const ANDROID_URL =
  'https://appdistribution.firebase.google.com/testerapps/1:1017210896283:android:a3badb8c5a545b7beceb3e/releases/029e6kfravka0?utm_source=firebase-tools';

describe('parseTeamcityDate', () => {
  it.each([
    { text: '20261123T191020+0000', expected: 1795461020000 },
    { text: '20261123T141020-0500', expected: 1795461020000 },
    { text: '20261123T201020+0100', expected: 1795461020000 },
    { text: '2026-11-23', expected: null },
    { text: '', expected: null },
    { text: undefined, expected: null },
  ])('$text → $expected', ({ text, expected }) => {
    expect(parseTeamcityDate(text)).toBe(expected);
  });
});

describe('parseBuildNumber', () => {
  it.each([
    { text: '0.12.0.331', number: '331', version: '0.12.0' },
    { text: '1234', number: '1234', version: null },
    { text: '.1', number: null, version: null },
    { text: undefined, number: null, version: null },
  ])('$text → $number, $version', ({ text, number, version }) => {
    expect(parseBuildNumber(text)).toEqual({ number, version });
  });
});

// The first recorded run-list row with `field` set to `value`, or left out when `value` is undefined.
function runListWith(field: string, value: unknown): unknown {
  const row: Record<string, unknown> = { ...runListDev.build[0] };
  if (value === undefined) {
    delete row[field];
  } else {
    row[field] = value;
  }
  return { build: [row] };
}

describe('parseRunList', () => {
  it('reads every build of the recorded list', () => {
    const builds = parseRunList(runListDev);

    expect(builds).toHaveLength(2);
    expect(builds[0]).toEqual({
      id: '821339',
      buildTypeId: 'vggt_BashBest_Dev_BuildChain',
      number: '331',
      version: '0.12.0',
      branchName: 'protos/physics-fun',
      state: 'running',
      status: 'SUCCESS',
      statusText: 'Build chain is running (3 finished, 2 in queue, 2 running)',
      queuedAt: 1795461020000,
      startedAt: 1795461022000,
      finishedAt: null,
      startEstimate: null,
      waitReason: null,
      webUrl: 'https://peoplefun.teamcity.com/build/821339',
      triggeredBy: 'Build User',
    });
    expect(builds[1].finishedAt).toBe(1795458852000);
  });

  it.each([
    { name: 'a non-numeric id', field: 'id', value: 'x' },
    { name: 'no buildTypeId', field: 'buildTypeId', value: undefined },
    { name: 'an unknown state', field: 'state', value: 'deleted' },
    { name: 'no queuedDate', field: 'queuedDate', value: undefined },
  ])('parseRunList leaves out a row with $name', ({ field, value }) => {
    expect(parseRunList(runListWith(field, value))).toEqual([]);
  });

  it('reads a text as no builds', () => {
    expect(parseRunList('not json')).toEqual([]);
  });
});

describe('parseBuildQueue', () => {
  it('reads the queue with its estimate and wait reason', () => {
    const builds = parseBuildQueue(buildQueue);

    expect(builds.map((build) => build.id)).toEqual(['821400', '999001']);
    expect(builds[0]).toMatchObject({
      startEstimate: 1795465385000,
      waitReason: 'Waiting for a compatible agent',
      branchName: '<default>',
      state: 'queued',
    });
  });

  it('reads a row with no state as queued', () => {
    const builds = parseBuildQueue({
      build: [
        {
          id: 1,
          buildTypeId: 'X_Chain',
          queuedDate: '20261123T192000+0000',
        },
      ],
    });

    expect(builds.map((build) => build.state)).toEqual(['queued']);
  });
});

// A finished, successful dependency `id` whose one revision is `sha`.
function buildJobRow(id: number, sha: string) {
  return {
    id,
    buildTypeId: `X_Build${id}`,
    state: 'finished',
    status: 'SUCCESS',
    buildType: { name: `Build ${id}` },
    revisions: { revision: [{ version: sha }] },
  };
}

describe('parseChainDetail', () => {
  it.each([
    {
      fixture: 'chain-running.json',
      json: chainRunning,
      pattern: null,
      revision: A,
      percent: 75,
      leftSeconds: 900,
      stepText: 'Step 3/8: Build player',
      logJobIds: [],
    },
    {
      fixture: 'chain-running.json',
      json: chainRunning,
      pattern: /_Build(IOS|Android)_/,
      revision: A,
      percent: 50,
      leftSeconds: 900,
      stepText: 'Step 3/8: Build player',
      logJobIds: [],
    },
    {
      fixture: 'chain-finished.json',
      json: chainFinished,
      pattern: null,
      revision: F,
      percent: 100,
      leftSeconds: 0,
      stepText: null,
      logJobIds: ['821193', '821198', '821196'],
    },
    {
      fixture: 'chain-failed.json',
      json: chainFailed,
      pattern: null,
      revision: A,
      percent: 100,
      leftSeconds: 0,
      stepText: null,
      logJobIds: ['821143', '821146'],
    },
  ])(
    '$fixture with pattern $pattern',
    ({
      json,
      pattern,
      revision,
      percent,
      leftSeconds,
      stepText,
      logJobIds,
    }) => {
      expect(parseChainDetail(json, pattern)).toMatchObject({
        revision,
        percent,
        leftSeconds,
        stepText,
        logJobIds,
      });
    },
  );

  it('maps each job of the running chain', () => {
    expect(parseChainDetail(chainRunning, null)?.jobs).toEqual([
      {
        id: '821331',
        label: 'Embedded Shell Script Artifacts',
        state: 'finished',
        result: 'success',
        percent: 100,
        leftSeconds: 0,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821332',
        label: 'Build Parameters Dev',
        state: 'finished',
        result: 'success',
        percent: 100,
        leftSeconds: 0,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821333',
        label: 'App Version',
        state: 'finished',
        result: 'success',
        percent: 100,
        leftSeconds: 0,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821337',
        label: 'Build iOS Dev',
        state: 'running',
        result: null,
        percent: 40,
        leftSeconds: 900,
        stepText: 'Step 3/8: Build player',
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821335',
        label: 'Build Android Dev',
        state: 'running',
        result: null,
        percent: 60,
        leftSeconds: 0,
        stepText: 'Step 5/8: Gradle',
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821338',
        label: 'Deploy iOS Dev',
        state: 'queued',
        result: null,
        percent: 0,
        leftSeconds: null,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
      {
        id: '821336',
        label: 'Deploy Android Dev',
        state: 'queued',
        result: null,
        percent: 0,
        leftSeconds: null,
        stepText: null,
        webUrl: null,
        startedAt: null,
        finishedAt: null,
        dependsOn: [],
      },
    ]);
  });

  it('maps a failed and a cancelled job', () => {
    const jobs = parseChainDetail(chainFailed, null)?.jobs ?? [];

    expect(
      jobs.map(({ id, result, stepText }) => ({ id, result, stepText })),
    ).toEqual([
      { id: '821141', result: 'success', stepText: null },
      { id: '821143', result: 'success', stepText: null },
      { id: '821144', result: 'success', stepText: null },
      {
        id: '821148',
        result: 'failure',
        stepText: 'Exit code 65 (Step: Build Xcode project)',
      },
      { id: '821145', result: 'success', stepText: null },
      { id: '821149', result: 'cancelled', stepText: null },
      { id: '821146', result: 'success', stepText: null },
    ]);
  });

  it.each([
    { first: F, second: A, revision: F },
    { first: A, second: F, revision: A },
  ])(
    'takes the revision of the first Build job on a tie: $first, $second',
    ({ first, second, revision }) => {
      const detail = {
        state: 'running',
        'snapshot-dependencies': {
          build: [buildJobRow(1, first), buildJobRow(2, second)],
        },
      };

      expect(parseChainDetail(detail, null)?.revision).toBe(revision);
    },
  );

  const emptyDetail = {
    revision: null,
    percent: null,
    leftSeconds: null,
    stepText: null,
    jobs: [],
    logJobIds: [],
  };

  it.each([
    { name: 'a text', json: 'not json', result: null },
    {
      name: 'a detail with no snapshot dependencies',
      json: { id: 1, state: 'finished' },
      result: emptyDetail,
    },
    {
      name: 'a dependencies object with no build array',
      json: { id: 1, state: 'finished', 'snapshot-dependencies': { count: 0 } },
      result: emptyDetail,
    },
  ])('parseChainDetail of $name', ({ json, result }) => {
    expect(parseChainDetail(json, null)).toEqual(result);
  });
});

describe('readFirebaseLinks', () => {
  it.each([
    {
      name: 'deploy-ios.log',
      log: deployIosLog,
      links: [{ label: 'iOS', url: IOS_URL }],
    },
    {
      name: 'deploy-android.log',
      log: deployAndroidLog,
      links: [{ label: 'Android', url: ANDROID_URL }],
    },
    {
      name: 'a link of another platform',
      log: 'see https://appdistribution.firebase.google.com/testerapps/1:9:web:ab/releases/x',
      links: [
        {
          label: 'Install',
          url: 'https://appdistribution.firebase.google.com/testerapps/1:9:web:ab/releases/x',
        },
      ],
    },
    { name: 'a log with no links', log: 'no links here', links: [] },
  ])('reads $name', ({ log, links }) => {
    expect(readFirebaseLinks(log)).toEqual(links);
  });
});
