import { describe, expect, it } from 'vitest';
import type { FileStat } from '../contracts/files';
import type { OsName } from '../contracts/platform';
import { posixPaths } from './paths/posix-paths';
import { windowsPaths } from './paths/windows-paths';
import {
  envVariable,
  findCandidate,
  findProgram,
  type ProgramSearch,
  shimLaunch,
} from './program-lookup';

// A `stat` over `present` files and `folders`, recording every path asked;
// Windows compares paths without case.
function statOver(
  os: OsName,
  present: readonly string[],
  folders: readonly string[] = [],
) {
  const asked: string[] = [];
  const key = (path: string) => (os === 'windows' ? path.toLowerCase() : path);
  const fileKeys = new Set(present.map(key));
  const folderKeys = new Set(folders.map(key));
  const files = {
    stat: async (path: string): Promise<FileStat | null> => {
      asked.push(path);
      if (folderKeys.has(key(path))) {
        return { isFolder: true, isLink: false };
      }
      return fileKeys.has(key(path))
        ? { isFolder: false, isLink: false }
        : null;
    },
  };
  return { asked, files };
}

function windowsSearch(
  path: string,
  pathExt: string | undefined = '.COM;.EXE;.BAT;.CMD',
): ProgramSearch {
  return {
    os: 'windows',
    path,
    pathExt,
    homeDir: 'C:\\Users\\u',
    paths: windowsPaths,
  };
}

function macSearch(path: string): ProgramSearch {
  return {
    os: 'macos',
    path,
    pathExt: undefined,
    homeDir: '/Users/u',
    paths: posixPaths,
  };
}

describe('findProgram', () => {
  it.each<{
    command: string;
    path: string;
    pathExt?: string;
    present?: string[];
    folders?: string[];
    expected: string | null;
  }>([
    {
      command: 'git',
      path: 'C:\\Git\\cmd;C:\\Tools',
      present: ['C:\\Git\\cmd\\git.exe'],
      expected: 'C:\\Git\\cmd\\git.exe',
    },
    {
      command: 'claude',
      path: 'C:\\npm;C:\\Users\\u\\.local\\bin',
      present: ['C:\\npm\\claude.cmd', 'C:\\Users\\u\\.local\\bin\\claude.exe'],
      expected: 'C:\\npm\\claude.cmd',
    },
    {
      command: 'x',
      path: 'C:\\T',
      present: ['C:\\T\\x.cmd', 'C:\\T\\x.exe'],
      expected: 'C:\\T\\x.exe',
    },
    {
      command: 'X.CMD',
      path: 'C:\\T',
      pathExt: '.exe;.cmd',
      present: ['C:\\T\\X.CMD'],
      expected: 'C:\\T\\X.CMD',
    },
    {
      command: 'python',
      path: ';"C:\\Program Files\\Python";;',
      present: ['C:\\Program Files\\Python\\python.exe'],
      expected: 'C:\\Program Files\\Python\\python.exe',
    },
    {
      command: 'tool',
      path: 'C:\\T',
      pathExt: '',
      present: ['C:\\T\\tool.bat'],
      expected: 'C:\\T\\tool.bat',
    },
    {
      command: '~\\.local\\bin\\claude',
      path: 'C:\\Other',
      present: ['C:\\Users\\u\\.local\\bin\\claude.exe'],
      expected: 'C:\\Users\\u\\.local\\bin\\claude.exe',
    },
    {
      command: 'C:\\T\\tool.cmd',
      path: 'C:\\Other',
      present: ['C:\\T\\tool.cmd'],
      expected: 'C:\\T\\tool.cmd',
    },
    {
      command: 'python',
      path: 'C:\\T',
      folders: ['C:\\T\\python.exe'],
      expected: null,
    },
    { command: 'python3', path: 'C:\\T', expected: null },
  ])(
    'on Windows finds $command over $path as $expected',
    async ({ command, path, pathExt, present = [], folders, expected }) => {
      const { files } = statOver('windows', present, folders);

      const found = await findProgram(
        command,
        windowsSearch(path, pathExt),
        files,
      );

      // Windows paths ignore case, and PATHEXT appends its own case.
      expect(found?.toLowerCase() ?? null).toBe(
        expected?.toLowerCase() ?? null,
      );
    },
  );

  it('on Windows tries a name with a PATHEXT extension only as it is', async () => {
    const { asked, files } = statOver('windows', ['C:\\Windows\\py.exe']);

    const found = await findProgram(
      'py.exe',
      windowsSearch('C:\\Windows'),
      files,
    );

    expect(found).toBe('C:\\Windows\\py.exe');
    expect(asked).toEqual(['C:\\Windows\\py.exe']);
  });

  it('on Windows goes on to the next folder when a stat throws', async () => {
    const files = {
      stat: async (path: string): Promise<FileStat | null> => {
        if (path.startsWith('C:\\Locked')) {
          throw new Error(`EACCES: permission denied, stat '${path}'`);
        }
        return path === 'C:\\T\\python.EXE'
          ? { isFolder: false, isLink: false }
          : null;
      },
    };

    const found = await findProgram(
      'python',
      windowsSearch('C:\\Locked;C:\\T'),
      files,
    );

    expect(found).toBe('C:\\T\\python.EXE');
  });

  it.each<{
    command: string;
    path: string;
    present?: string[];
    folders?: string[];
    expected: string | null;
  }>([
    {
      command: 'python3',
      path: '/usr/local/bin:/usr/bin',
      present: ['/usr/bin/python3'],
      expected: '/usr/bin/python3',
    },
    {
      command: 'python3',
      path: '/usr/local/bin:/usr/bin',
      present: ['/usr/local/bin/python3', '/usr/bin/python3'],
      expected: '/usr/local/bin/python3',
    },
    {
      command: 'python3',
      path: '/usr/bin',
      present: ['/usr/bin/python3.exe'],
      expected: null,
    },
    {
      command: '~/.local/bin/claude',
      path: '/usr/bin',
      present: ['/Users/u/.local/bin/claude'],
      expected: '/Users/u/.local/bin/claude',
    },
    { command: '/opt/x', path: '/usr/bin', expected: null },
    {
      command: 'claude',
      path: '/usr/bin',
      folders: ['/usr/bin/claude'],
      expected: null,
    },
  ])(
    'on macOS finds $command over $path as $expected',
    async ({ command, path, present = [], folders, expected }) => {
      const { files } = statOver('macos', present, folders);

      expect(await findProgram(command, macSearch(path), files)).toBe(expected);
    },
  );

  it('on macOS skips empty PATH entries, so the current folder is never searched', async () => {
    const { asked, files } = statOver('macos', ['/usr/bin/python3']);

    const found = await findProgram('python3', macSearch(':/usr/bin:'), files);

    expect(found).toBe('/usr/bin/python3');
    expect(asked).toEqual(['/usr/bin/python3']);
  });
});

describe('findCandidate', () => {
  const candidates = [
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
  ];

  it.each<{ present: string[]; expected: unknown }>([
    {
      present: ['C:\\T\\python.EXE'],
      expected: { command: 'C:\\T\\python.EXE', args: [] },
    },
    {
      present: ['C:\\T\\py.EXE', 'C:\\T\\python.EXE'],
      expected: { command: 'C:\\T\\py.EXE', args: ['-3'] },
    },
    { present: [], expected: null },
  ])(
    'takes the first candidate found among $present',
    async ({ present, expected }) => {
      const { files } = statOver('windows', present);

      expect(
        await findCandidate(candidates, windowsSearch('C:\\T'), files),
      ).toEqual(expected);
    },
  );
});

describe('envVariable', () => {
  it.each<{
    env: Record<string, string>;
    os: OsName;
    expected: string | undefined;
  }>([
    { env: { Path: 'A' }, os: 'windows', expected: 'A' },
    { env: { Path: 'A' }, os: 'macos', expected: undefined },
    { env: { PATH: 'B' }, os: 'linux', expected: 'B' },
  ])('reads PATH from $env on $os as $expected', ({ env, os, expected }) => {
    expect(envVariable(env, 'PATH', os)).toBe(expected);
  });
});

describe('shimLaunch', () => {
  const COM_SPEC = 'C:\\Windows\\system32\\cmd.exe';

  it.each<{ os: OsName; target: string; args: string[] }>([
    { os: 'macos', target: '/x/tool.cmd', args: ['a'] },
    { os: 'windows', target: 'C:\\Git\\cmd\\git.exe', args: ['status'] },
  ])('starts $target on $os directly', ({ os, target, args }) => {
    expect(shimLaunch(target, args, os, COM_SPEC)).toEqual({
      file: target,
      args,
      windowsVerbatimArguments: false,
    });
  });

  it('starts a Windows .cmd through cmd.exe with no quoting from Node', () => {
    expect(
      shimLaunch(
        'C:\\npm\\claude.cmd',
        ['auth', 'status', '--json'],
        'windows',
        COM_SPEC,
      ),
    ).toEqual({
      file: COM_SPEC,
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\npm\\claude.cmd ^"auth^" ^"status^" ^"--json^""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it.each<{ target: string; arg: string; line: string }>([
    {
      target: 'C:\\Program Files\\x\\t.BAT',
      arg: 'a b',
      line: '"C:\\Program^ Files\\x\\t.BAT ^"a^ b^""',
    },
    { target: 'C:\\t.cmd', arg: '50%&x', line: '"C:\\t.cmd ^"50^%^&x^""' },
    {
      target: 'C:\\t.cmd',
      arg: 'say "hi"',
      line: '"C:\\t.cmd ^"say^ \\^"hi\\^"^""',
    },
    {
      target: 'C:\\t.cmd',
      arg: 'a\\"b',
      line: '"C:\\t.cmd ^"a\\\\\\^"b^""',
    },
    {
      target: 'C:\\t.cmd',
      arg: 'C:\\dir\\',
      line: '"C:\\t.cmd ^"C:\\dir\\\\^""',
    },
    { target: 'C:\\t.cmd', arg: '', line: '"C:\\t.cmd ^"^""' },
  ])('escapes $arg for cmd.exe as $line', ({ target, arg, line }) => {
    expect(shimLaunch(target, [arg], 'windows', COM_SPEC).args.at(-1)).toBe(
      line,
    );
  });

  it('refuses an argument holding a line break on a .cmd', () => {
    expect(() =>
      shimLaunch('C:\\t.cmd', ['a\nb'], 'windows', COM_SPEC),
    ).toThrow('line break');
  });
});
