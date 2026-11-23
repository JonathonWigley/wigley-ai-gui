import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../contracts/processes';
import { FakeProcesses } from '../../shared/fake-processes';
import { createGhPullRequests } from './gh-pull-requests';

const FOLDER = '/r';
const PR_LIST_ARGS = [
  'pr',
  'list',
  '--state',
  'all',
  '--json',
  'number,title,url,headRefName,state,updatedAt',
  '--limit',
  '100',
];

const OPEN_RECORD = {
  number: 42,
  title: 'Add the inbox',
  url: 'https://github.com/o/r/pull/42',
  headRefName: 'work-inbox',
  state: 'OPEN',
  updatedAt: '2026-11-20T10:15:00Z',
};
const MERGED_RECORD = {
  number: 17,
  title: 'Fix the sweep',
  url: 'https://github.com/o/r/pull/17',
  headRefName: 'fix/sweep',
  state: 'MERGED',
  updatedAt: '2026-11-02T08:00:00Z',
};
const CLOSED_RECORD = {
  number: 9,
  title: 'Try a spike',
  url: 'https://github.com/o/r/pull/9',
  headRefName: 'spike/inbox',
  state: 'CLOSED',
  updatedAt: '2026-10-30T23:59:59Z',
};

function exited(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, stdout, stderr, timedOut: false };
}

function setUp(result: ProcessResult | Error) {
  const processes = new FakeProcesses();
  processes.script('gh', PR_LIST_ARGS, result);
  return { processes, pullRequests: createGhPullRequests({ processes }) };
}

describe('createGhPullRequests', () => {
  it('forRepo_GhOutput_MapsEachRecord', async () => {
    const test = setUp(exited(0, JSON.stringify([OPEN_RECORD, MERGED_RECORD])));

    expect(await test.pullRequests.forRepo(FOLDER)).toEqual([
      {
        number: 42,
        title: 'Add the inbox',
        url: 'https://github.com/o/r/pull/42',
        headBranch: 'work-inbox',
        state: 'open',
        updatedAt: '2026-11-20T10:15:00Z',
      },
      {
        number: 17,
        title: 'Fix the sweep',
        url: 'https://github.com/o/r/pull/17',
        headBranch: 'fix/sweep',
        state: 'merged',
        updatedAt: '2026-11-02T08:00:00Z',
      },
    ]);
    expect(test.processes.runs[0]).toMatchObject({
      command: 'gh',
      args: PR_LIST_ARGS,
      cwd: FOLDER,
      timeoutMs: 15000,
      setEnv: { GH_PROMPT_DISABLED: '1' },
    });
  });

  const withoutHeadRefName = {
    number: 42,
    title: 'Add the inbox',
    url: 'https://github.com/o/r/pull/42',
    state: 'OPEN',
    updatedAt: '2026-11-20T10:15:00Z',
  };
  it.each<[string, unknown]>([
    ['state DRAFT', { ...OPEN_RECORD, state: 'DRAFT' }],
    ['number a string', { ...OPEN_RECORD, number: '42' }],
    ['headRefName missing', withoutHeadRefName],
    ['title a number', { ...OPEN_RECORD, title: 42 }],
    ['url null', { ...OPEN_RECORD, url: null }],
    ['updatedAt a number', { ...OPEN_RECORD, updatedAt: 1763633700 }],
    ['an element null', null],
    ['an element 5', 5],
  ])('forRepo_UnreadableRecord_DropsOnlyIt: %s', async (_name, bad) => {
    const test = setUp(exited(0, JSON.stringify([bad, CLOSED_RECORD])));

    expect(await test.pullRequests.forRepo(FOLDER)).toEqual([
      {
        number: 9,
        title: 'Try a spike',
        url: 'https://github.com/o/r/pull/9',
        headBranch: 'spike/inbox',
        state: 'closed',
        updatedAt: '2026-10-30T23:59:59Z',
      },
    ]);
  });

  it.each<[string, ProcessResult | Error]>([
    ['signed out', exited(4, '', 'gh auth login')],
    [
      'no GitHub remote',
      exited(
        1,
        '',
        'none of the git remotes configured for this repository point to a known GitHub host',
      ),
    ],
    ['gh cannot start', new Error('Could not run gh: ENOENT')],
    ['timed out', { code: -1, stdout: '', stderr: '', timedOut: true }],
    ['stdout not json', exited(0, 'not json')],
    ['stdout an object', exited(0, '{}')],
  ])('forRepo_GhCannotAnswer_Null: %s', async (_name, result) => {
    const test = setUp(result);

    await expect(test.pullRequests.forRepo(FOLDER)).resolves.toBeNull();
  });

  it('forRepo_NoPullRequests_EmptyList', async () => {
    const test = setUp(exited(0, '[]'));

    expect(await test.pullRequests.forRepo(FOLDER)).toEqual([]);
  });
});
