import { describe, expect, it } from 'vitest';
import type { ChatSessionInfo } from '../../chat/contract';
import type { SessionRow } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { StatsProcessRow } from '../contract';
import { appKeyOf, groupProcesses, sessionProcesses } from './grouping';
import type { ProcessRate } from './snapshot';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_HELPER =
  '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)';
const CODE_NODE =
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/node';

function rate(
  pid: number,
  ppid: number,
  name: string,
  path: string,
  cpuPercent: number,
  rssBytes: number,
  gpuPercent: number | null,
): ProcessRate {
  return { pid, ppid, name, path, cpuPercent, rssBytes, gpuPercent };
}

function row(process: ProcessRate): StatsProcessRow {
  return {
    id: `pid:${process.pid}`,
    name: process.name,
    kind: 'process',
    cpuPercent: process.cpuPercent,
    rssBytes: process.rssBytes,
    gpuPercent: process.gpuPercent,
    children: [],
  };
}

describe('appKeyOf', () => {
  it.each([
    {
      name: 'Google Chrome Helper (Renderer)',
      path: CHROME_HELPER,
      key: { id: 'app:Google Chrome.app', name: 'Google Chrome' },
    },
    { name: 'zsh', path: '/usr/bin/zsh', key: { id: 'app:zsh', name: 'zsh' } },
    {
      name: 'Code.exe',
      path: 'C:\\Program Files\\Code\\Code.exe',
      key: { id: 'app:Code.exe', name: 'Code.exe' },
    },
    {
      name: 'kernel_task',
      path: '',
      key: { id: 'app:kernel_task', name: 'kernel_task' },
    },
  ])('appKeyOf_BundleOrName: $name', ({ name, path, key }) => {
    expect(appKeyOf({ name, path })).toEqual(key);
  });
});

describe('groupProcesses', () => {
  it('groupProcesses_Tree', () => {
    const finder = rate(
      300,
      1,
      'Finder',
      '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
      0.5,
      400,
      0,
    );
    const chrome = rate(501, 1, 'Google Chrome', CHROME, 4, 600, 1);
    const claude = rate(
      610,
      1,
      'claude',
      '/Users/u/.local/bin/claude',
      6,
      500,
      null,
    );
    const helper = rate(
      502,
      501,
      'Google Chrome Helper (Renderer)',
      CHROME_HELPER,
      18.5,
      1200,
      null,
    );
    const zsh = rate(611, 610, 'zsh', '/bin/zsh', 3, 200, null);
    const node = rate(612, 611, 'node', CODE_NODE, 2, 300, null);
    // A second session's agent, started under the first session's tree.
    const innerClaude = rate(
      700,
      612,
      'claude',
      '/Users/u/.local/bin/claude',
      1.5,
      250,
      2,
    );
    const innerShell = rate(701, 700, 'bash', '/bin/bash', 0.25, 50, null);
    const launchd = rate(1, 0, 'launchd', '/sbin/launchd', 0.1, 10, null);

    const rows = groupProcesses(
      [
        finder,
        chrome,
        claude,
        helper,
        zsh,
        node,
        innerClaude,
        innerShell,
        launchd,
      ],
      [
        { sessionId: 'outer', pid: 610, title: 'fix login' },
        { sessionId: 'inner', pid: 700, title: 'run tests' },
        { sessionId: 'again', pid: 610, title: 'same pid' },
      ],
    );

    expect(rows).toEqual([
      {
        id: 'session:outer',
        name: 'claude · fix login',
        kind: 'session',
        cpuPercent: 11,
        rssBytes: 1000,
        gpuPercent: null,
        children: [row(claude), row(zsh), row(node)],
      },
      {
        id: 'session:inner',
        name: 'claude · run tests',
        kind: 'session',
        cpuPercent: 1.75,
        rssBytes: 300,
        gpuPercent: 2,
        children: [row(innerClaude), row(innerShell)],
      },
      row(finder),
      {
        id: 'app:Google Chrome.app',
        name: 'Google Chrome',
        kind: 'app',
        cpuPercent: 22.5,
        rssBytes: 1800,
        gpuPercent: 1,
        children: [row(chrome), row(helper)],
      },
      row(launchd),
    ]);
  });
});

describe('sessionProcesses', () => {
  const TITLES = { user: null, agent: null, firstMessage: null };

  function info(sessionId: string, pid: number | null): ChatSessionInfo {
    return { sessionId, pid } as ChatSessionInfo;
  }

  it.each<{
    case: string;
    chat: ChatSessionInfo;
    rows: SessionRow[];
    expected: { sessionId: string; pid: number; title: string }[];
  }>([
    {
      case: 'user title',
      chat: info('s1', 610),
      rows: [
        sessionRow('s1', {
          titles: { ...TITLES, user: 'fix login', agent: 'agent says' },
        }),
      ],
      expected: [{ sessionId: 's1', pid: 610, title: 'fix login' }],
    },
    {
      case: 'no titles',
      chat: info('s2', 620),
      rows: [sessionRow('s2')],
      expected: [{ sessionId: 's2', pid: 620, title: 'label s2' }],
    },
    {
      case: 'no pid',
      chat: info('s3', null),
      rows: [sessionRow('s3', { titles: { ...TITLES, user: 'idle' } })],
      expected: [],
    },
    {
      case: 'no row',
      chat: info('s4', 640),
      rows: [sessionRow('other', { titles: { ...TITLES, user: 'other' } })],
      expected: [],
    },
  ])(
    'sessionProcesses_JoinsRowsAndTitles: $case',
    ({ chat, rows, expected }) => {
      const byId = new Map(rows.map((each) => [each.sessionId, each]));

      expect(sessionProcesses([chat], byId)).toEqual(expected);
    },
  );
});
