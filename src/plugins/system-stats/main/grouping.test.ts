import { describe, expect, it } from 'vitest';
import type { ChatSessionInfo } from '../../chat/contract';
import type { SessionRow } from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type { StatsProcessRow } from '../contract';
import { appKeyOf, groupProcesses, sessionProcesses } from './grouping';
import type { ProcessRate, SessionProcess } from './snapshot';

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
  const CLAUDE_BIN = '/Users/u/.local/bin/claude';
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
  const claude = rate(610, 1, 'claude', CLAUDE_BIN, 6, 500, null);
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
  const innerClaude = rate(700, 612, 'claude', CLAUDE_BIN, 1.5, 250, 2);
  const innerShell = rate(701, 700, 'bash', '/bin/bash', 0.25, 50, null);
  const launchd = rate(1, 0, 'launchd', '/sbin/launchd', 0.1, 10, null);
  // A terminal session the app did not start.
  const terminalClaude = rate(800, 1, 'claude', CLAUDE_BIN, 0.5, 100, null);
  const PROCESSES = [
    finder,
    chrome,
    claude,
    helper,
    zsh,
    node,
    innerClaude,
    innerShell,
    launchd,
    terminalClaude,
  ];
  const CHROME_GROUP: StatsProcessRow = {
    id: 'app:Google Chrome.app',
    name: 'Google Chrome',
    kind: 'app',
    cpuPercent: 22.5,
    rssBytes: 1800,
    gpuPercent: 1,
    children: [row(chrome), row(helper)],
  };

  it.each<{
    case: string;
    sessions: SessionProcess[];
    expected: StatsProcessRow[];
  }>([
    {
      case: 'sessions holding processes join the Claude group with the terminal claude',
      sessions: [
        { sessionId: 'outer', pid: 610, title: 'fix login' },
        { sessionId: 'inner', pid: 700, title: 'run tests' },
        { sessionId: 'again', pid: 610, title: 'same pid' },
        { sessionId: 'gone', pid: 999, title: 'exited' },
      ],
      expected: [
        {
          id: 'app:claude',
          name: 'Claude',
          kind: 'app',
          cpuPercent: 13.25,
          rssBytes: 1400,
          gpuPercent: 2,
          children: [
            {
              id: 'session:outer',
              name: 'claude · fix login',
              kind: 'process',
              cpuPercent: 11,
              rssBytes: 1000,
              gpuPercent: null,
              children: [],
            },
            {
              id: 'session:inner',
              name: 'claude · run tests',
              kind: 'process',
              cpuPercent: 1.75,
              rssBytes: 300,
              gpuPercent: 2,
              children: [],
            },
            row(terminalClaude),
          ],
        },
        row(finder),
        CHROME_GROUP,
        row(launchd),
      ],
    },
    {
      case: 'no session holding a process groups claude as any app',
      sessions: [{ sessionId: 'gone', pid: 999, title: 'exited' }],
      expected: [
        row(finder),
        CHROME_GROUP,
        {
          id: 'app:claude',
          name: 'claude',
          kind: 'app',
          cpuPercent: 8,
          rssBytes: 850,
          gpuPercent: 2,
          children: [row(claude), row(innerClaude), row(terminalClaude)],
        },
        row(zsh),
        row(node),
        row(innerShell),
        row(launchd),
      ],
    },
  ])('groupProcesses_Tree: $case', ({ sessions, expected }) => {
    expect(groupProcesses(PROCESSES, sessions)).toEqual(expected);
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
