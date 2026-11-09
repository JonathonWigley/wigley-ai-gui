import { describe, expect, it, vi } from 'vitest';
import type { FileStat } from '../../../contracts/files';
import type { LaunchRequest } from '../contract';
import {
  START_SESSION_TOOL,
  startSessionToolSession,
} from './start-session-tool';

const CONTEXT = { toolUseId: null, signal: new AbortController().signal };
const FOLDER: FileStat = { isFolder: true, isLink: false };
const FILE: FileStat = { isFolder: false, isLink: false };

interface Row {
  name: string;
  args: unknown;
  callerFolder?: string | null;
  // Whether the calling session is headless; false when absent.
  callerHeadless?: boolean;
  // Chat's default profile for the caller.
  defaultProfile?: string | null;
  profiles?: string[];
  // What `stat` answers, or the error it rejects with.
  stat?: FileStat | null | Error;
  launchError?: string;
  launched?: LaunchRequest;
  success?: string;
  // Fragments of the error text.
  errors?: string[];
  statCalled?: boolean;
  // Fragments of the one log line the call writes.
  logged?: string[];
}

function message(text: string) {
  return { text, images: [] };
}

const ROWS: Row[] = [
  {
    name: 'a prompt alone uses the caller’s folder and default profile',
    args: { prompt: '  review the diff  ' },
    launched: {
      projectDir: '/caller',
      profile: 'home',
      message: message('  review the diff  '),
      headless: false,
    },
    success:
      'Launched session row-7 in /caller under profile home. A failure to start shows on its row.',
  },
  {
    name: 'a null folder and profile take the same defaults',
    args: { prompt: 'go', profile: null, folder: null },
    launched: {
      projectDir: '/caller',
      profile: 'home',
      message: message('go'),
      headless: false,
    },
    success:
      'Launched session row-7 in /caller under profile home. A failure to start shows on its row.',
  },
  {
    name: 'a named folder and profile win over the caller’s',
    args: { prompt: 'go', folder: '/other', profile: 'work' },
    launched: {
      projectDir: '/other',
      profile: 'work',
      message: message('go'),
      headless: false,
    },
    success:
      'Launched session row-7 in /other under profile work. A failure to start shows on its row.',
  },
  {
    name: 'a headless caller launches headless',
    args: { prompt: 'go' },
    callerHeadless: true,
    launched: {
      projectDir: '/caller',
      profile: 'home',
      message: message('go'),
      headless: true,
    },
    success:
      'Launched session row-7 in /caller under profile home. A failure to start shows on its row.',
  },
  {
    name: 'an unknown profile names the known ones',
    args: { prompt: 'go', profile: 'nope' },
    errors: ['nope', 'work, home'],
    statCalled: false,
  },
  {
    name: 'an unknown profile when chat has none says so',
    args: { prompt: 'go', profile: 'x' },
    profiles: [],
    errors: ['none'],
    statCalled: false,
  },
  {
    name: 'a blank profile',
    args: { prompt: 'go', profile: '  ' },
    errors: ['profile'],
    statCalled: false,
  },
  {
    name: 'a non-string profile',
    args: { prompt: 'go', profile: 7 },
    errors: ['profile'],
    statCalled: false,
  },
  {
    name: 'no folder given and the caller has none',
    args: { prompt: 'go' },
    callerFolder: null,
    errors: ['folder'],
    statCalled: false,
  },
  {
    name: 'a blank folder',
    args: { prompt: 'go', folder: '  ' },
    errors: ['folder'],
    statCalled: false,
  },
  {
    name: 'a non-string folder',
    args: { prompt: 'go', folder: 7 },
    errors: ['folder'],
    statCalled: false,
  },
  {
    name: 'a relative folder',
    args: { prompt: 'go', folder: 'relative/dir' },
    errors: ['relative/dir'],
    statCalled: false,
  },
  {
    name: 'a missing folder names the path',
    args: { prompt: 'go', folder: '/gone' },
    stat: null,
    errors: ['/gone'],
  },
  {
    name: 'a path that is a file names the path',
    args: { prompt: 'go', folder: '/a-file' },
    stat: FILE,
    errors: ['/a-file'],
  },
  {
    name: 'a rejected stat carries its message',
    args: { prompt: 'go' },
    stat: new Error('disk gone'),
    errors: ['disk gone'],
    logged: ['/caller', 'disk gone'],
  },
  {
    name: 'a missing prompt',
    args: {},
    errors: ['prompt'],
    statCalled: false,
  },
  {
    name: 'a non-string prompt',
    args: { prompt: 7 },
    errors: ['prompt'],
    statCalled: false,
  },
  {
    name: 'a blank prompt',
    args: { prompt: '  ' },
    errors: ['prompt'],
    statCalled: false,
  },
  {
    name: 'null args',
    args: null,
    errors: ['prompt'],
    statCalled: false,
  },
  {
    name: 'a launch that throws carries its message',
    args: { prompt: 'go' },
    launchError: 'profile removed',
    errors: ['profile removed'],
    logged: ['profile removed'],
  },
  {
    name: 'no profiles and none named',
    args: { prompt: 'go' },
    defaultProfile: null,
    errors: ['profiles'],
    statCalled: false,
  },
];

function toolSession(row: Row) {
  const launch = vi.fn<(request: LaunchRequest) => string>(() => {
    if (row.launchError !== undefined) {
      throw new Error(row.launchError);
    }
    return 'row-7';
  });
  const stat = vi.fn<(path: string) => Promise<FileStat | null>>(() => {
    const answer = row.stat === undefined ? FOLDER : row.stat;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  const log = vi.fn<(line: string) => void>();
  const session = startSessionToolSession({
    launch,
    isHeadless: (sessionId) =>
      sessionId === 'caller' && row.callerHeadless === true,
    defaultProfile: (sessionId) =>
      sessionId === 'caller' && row.defaultProfile !== null
        ? (row.defaultProfile ?? 'home')
        : null,
    profileNames: () => row.profiles ?? ['work', 'home'],
    isAbsolute: (path) => path.startsWith('/'),
    stat,
    log,
  })({
    id: 'caller',
    info: {
      sessionId: 'host-1',
      projectDir: row.callerFolder === undefined ? '/caller' : row.callerFolder,
      harness: 'claude',
    },
  });
  return { launch, stat, log, session };
}

describe('start_session', () => {
  it.each(ROWS)('$name', async (row) => {
    const { launch, stat, log, session } = toolSession(row);

    const result = await session.call(
      START_SESSION_TOOL.name,
      row.args,
      CONTEXT,
    );

    const text = result.content[0]?.text;
    if (row.success !== undefined) {
      expect(result.isError ?? false).toBe(false);
      expect(text).toBe(row.success);
      expect(launch).toHaveBeenCalledExactlyOnceWith(row.launched);
      return;
    }
    expect(result.isError).toBe(true);
    for (const fragment of row.errors ?? []) {
      expect(text).toContain(fragment);
    }
    if (row.launchError === undefined) {
      expect(launch).not.toHaveBeenCalled();
    }
    if (row.statCalled === false) {
      expect(stat).not.toHaveBeenCalled();
    }
    for (const fragment of row.logged ?? []) {
      expect(log).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(fragment),
      );
    }
  });

  it('rejects any other tool name', async () => {
    const { session } = toolSession({ name: 'other', args: {} });

    await expect(session.call('other', {}, CONTEXT)).rejects.toThrow('other');
  });
});
