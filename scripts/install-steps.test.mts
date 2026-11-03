import { describe, expect, it } from 'vitest';
import {
  installPaths,
  installRootCleanup,
  isInstallDue,
  isStableAppProcess,
  parseInstallArgs,
  parseMacProcessList,
  parseWindowsProcessList,
  processesToQuit,
} from './install-steps.mts';

const USAGE = 'usage: npm run install-app -- [--ref <ref>]';

const WINDOWS_ENV = {
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
};

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const WINDOWS_ROOT = 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui';

const MAC_BINARY =
  '/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui';

function windowsPaths() {
  return installPaths(
    'win32',
    'x64',
    'D:\\ai-dev\\wigley-ai-gui',
    WINDOWS_ENV,
    COMMIT,
  );
}

function macPaths() {
  return installPaths(
    'darwin',
    'arm64',
    '/Users/me/ai-dev/wigley-ai-gui',
    {},
    COMMIT,
  );
}

describe('parseInstallArgs', () => {
  it('GIVEN no arguments WHEN parseInstallArgs runs THEN the ref is main', () => {
    expect(parseInstallArgs([])).toEqual({ ref: 'main' });
  });

  it('GIVEN --ref v2 WHEN parseInstallArgs runs THEN the ref is v2', () => {
    expect(parseInstallArgs(['--ref', 'v2'])).toEqual({ ref: 'v2' });
  });

  it('GIVEN an unknown flag WHEN parseInstallArgs runs THEN it throws a usage error naming the flag', () => {
    expect(() => parseInstallArgs(['--force'])).toThrow(
      `install-app does not take --force; ${USAGE}`,
    );
  });

  it('GIVEN --ref with no value WHEN parseInstallArgs runs THEN it throws the usage error', () => {
    expect(() => parseInstallArgs(['--ref'])).toThrow(
      `--ref takes a value; ${USAGE}`,
    );
  });

  it('GIVEN --ref=v2 WHEN parseInstallArgs runs THEN it throws the usage error', () => {
    expect(() => parseInstallArgs(['--ref=v2'])).toThrow(
      `install-app does not take --ref=v2; ${USAGE}`,
    );
  });
});

describe('installPaths', () => {
  it('GIVEN win32, x64, repo D:\\ai-dev\\wigley-ai-gui and LOCALAPPDATA/APPDATA set WHEN installPaths runs THEN every path equals the pinned value', () => {
    expect(windowsPaths()).toEqual({
      buildDir: 'D:\\ai-dev\\.wigley-ai-gui-build',
      packagedDir:
        'D:\\ai-dev\\.wigley-ai-gui-build\\out\\wigley-ai-gui-win32-x64',
      packagedApp:
        'D:\\ai-dev\\.wigley-ai-gui-build\\out\\wigley-ai-gui-win32-x64',
      installRoot: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui',
      installDir:
        'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\app-0123456789ab',
      stagingDir:
        'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\staging',
      binary:
        'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\app-0123456789ab\\wigley-ai-gui.exe',
      shortcut:
        'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Auri.lnk',
    });
  });

  it('GIVEN darwin, arm64 WHEN installPaths runs THEN packagedApp is the bundle in packagedDir, installDir is /Applications/wigley-ai-gui.app and shortcut null', () => {
    expect(macPaths()).toEqual({
      buildDir: '/Users/me/ai-dev/.wigley-ai-gui-build',
      packagedDir:
        '/Users/me/ai-dev/.wigley-ai-gui-build/out/wigley-ai-gui-darwin-arm64',
      packagedApp:
        '/Users/me/ai-dev/.wigley-ai-gui-build/out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app',
      installRoot: null,
      installDir: '/Applications/wigley-ai-gui.app',
      stagingDir: '/Applications/wigley-ai-gui.app.new',
      binary: '/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui',
      shortcut: null,
    });
  });

  it('GIVEN linux WHEN installPaths runs THEN it throws the pinned message', () => {
    expect(() =>
      installPaths('linux', 'x64', '/home/me/wigley-ai-gui', {}, COMMIT),
    ).toThrow('install-app supports Windows and macOS, not linux');
  });

  it('GIVEN win32 with no LOCALAPPDATA WHEN installPaths runs THEN it throws the pinned message', () => {
    expect(() =>
      installPaths(
        'win32',
        'x64',
        'D:\\ai-dev\\wigley-ai-gui',
        { APPDATA: WINDOWS_ENV.APPDATA },
        COMMIT,
      ),
    ).toThrow('install-app needs LOCALAPPDATA and APPDATA set');
  });
});

describe('installRootCleanup', () => {
  it.each([
    {
      entries: [
        'wigley-ai-gui.exe',
        'resources',
        'locales',
        'app-0123456789ab',
      ],
      olderAppFolders: [],
      leftovers: ['locales', 'resources', 'wigley-ai-gui.exe'],
    },
    {
      entries: [
        'app-0123456789ab',
        'app-fedcba987654',
        'app-111111111111',
        'deleting-app-222222222222',
      ],
      olderAppFolders: ['app-111111111111', 'app-fedcba987654'],
      leftovers: ['deleting-app-222222222222'],
    },
    {
      entries: ['app-0123456789ab'],
      olderAppFolders: [],
      leftovers: [],
    },
  ])(
    'GIVEN $entries WHEN installRootCleanup runs THEN older folders are $olderAppFolders and leftovers $leftovers',
    ({ entries, olderAppFolders, leftovers }) => {
      expect(installRootCleanup(entries, 'app-0123456789ab')).toEqual({
        olderAppFolders,
        leftovers,
      });
    },
  );
});

describe('isStableAppProcess', () => {
  const olderWindowsExe = `${WINDOWS_ROOT}\\app-fedcba987654\\wigley-ai-gui.exe`;

  it.each([
    {
      name: 'an older version folder',
      platform: 'win32',
      executable: olderWindowsExe,
      commandLine: `"${olderWindowsExe}"`,
      expected: true,
    },
    {
      name: 'the flat install',
      platform: 'win32',
      executable: `${WINDOWS_ROOT}\\wigley-ai-gui.exe`,
      commandLine: `"${WINDOWS_ROOT}\\wigley-ai-gui.exe"`,
      expected: true,
    },
    {
      name: 'a path in another case',
      platform: 'win32',
      executable:
        'C:\\USERS\\ME\\APPDATA\\LOCAL\\PROGRAMS\\WIGLEY-AI-GUI\\app-0123456789ab\\wigley-ai-gui.exe',
      commandLine:
        '"C:\\USERS\\ME\\APPDATA\\LOCAL\\PROGRAMS\\WIGLEY-AI-GUI\\app-0123456789ab\\wigley-ai-gui.exe"',
      expected: true,
    },
    {
      name: 'a Windows session host',
      platform: 'win32',
      executable: olderWindowsExe,
      commandLine: `"${olderWindowsExe}" C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\app-fedcba987654\\resources\\app.asar\\.vite\\build\\session-host.js`,
      expected: false,
    },
    {
      name: 'a Windows packaged drive run',
      platform: 'win32',
      executable:
        'D:\\ai-dev\\.wigley-ai-gui-build\\out\\wigley-ai-gui-win32-x64\\wigley-ai-gui.exe',
      commandLine:
        '"D:\\ai-dev\\.wigley-ai-gui-build\\out\\wigley-ai-gui-win32-x64\\wigley-ai-gui.exe"',
      expected: false,
    },
    {
      name: 'another file name in a version folder',
      platform: 'win32',
      executable: `${WINDOWS_ROOT}\\app-fedcba987654\\other.exe`,
      commandLine: `"${WINDOWS_ROOT}\\app-fedcba987654\\other.exe"`,
      expected: false,
    },
    {
      name: 'the file name deeper under a version folder',
      platform: 'win32',
      executable: `${WINDOWS_ROOT}\\app-fedcba987654\\resources\\wigley-ai-gui.exe`,
      commandLine: `"${WINDOWS_ROOT}\\app-fedcba987654\\resources\\wigley-ai-gui.exe"`,
      expected: false,
    },
    {
      name: 'a version folder and file name in upper case',
      platform: 'win32',
      executable: `${WINDOWS_ROOT}\\APP-FEDCBA987654\\WIGLEY-AI-GUI.EXE`,
      commandLine: `"${WINDOWS_ROOT}\\APP-FEDCBA987654\\WIGLEY-AI-GUI.EXE"`,
      expected: true,
    },
    {
      name: 'the macOS app',
      platform: 'darwin',
      executable: MAC_BINARY,
      commandLine: MAC_BINARY,
      expected: true,
    },
    {
      name: 'a macOS session host',
      platform: 'darwin',
      executable: MAC_BINARY,
      commandLine: `${MAC_BINARY} /Applications/wigley-ai-gui.app/Contents/Resources/app.asar/.vite/build/session-host.js`,
      expected: false,
    },
    {
      name: 'a macOS packaged drive run',
      platform: 'darwin',
      executable:
        '/Users/me/ai-dev/wigley-ai-gui/out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui',
      commandLine:
        '/Users/me/ai-dev/wigley-ai-gui/out/wigley-ai-gui-darwin-arm64/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui',
      expected: false,
    },
  ] as const)(
    'GIVEN $name WHEN isStableAppProcess runs THEN $expected',
    ({ platform, executable, commandLine, expected }) => {
      const paths = platform === 'win32' ? windowsPaths() : macPaths();
      expect(isStableAppProcess(platform, paths, executable, commandLine)).toBe(
        expected,
      );
    },
  );
});

describe('processesToQuit', () => {
  it.each([
    {
      name: 'Windows keeps the build this run installs and quits the others',
      platform: 'win32',
      executables: [
        `${WINDOWS_ROOT}\\app-0123456789ab\\wigley-ai-gui.exe`,
        `${WINDOWS_ROOT}\\APP-0123456789AB\\WIGLEY-AI-GUI.EXE`,
        `${WINDOWS_ROOT}\\app-fedcba987654\\wigley-ai-gui.exe`,
        `${WINDOWS_ROOT}\\wigley-ai-gui.exe`,
      ],
      expected: [3, 4],
    },
    {
      name: 'macOS quits every match, even one directly in installDir',
      platform: 'darwin',
      executables: [MAC_BINARY, '/Applications/wigley-ai-gui.app/helper'],
      expected: [1, 2],
    },
  ] as const)(
    'GIVEN $name WHEN processesToQuit runs THEN pids $expected',
    ({ platform, executables, expected }) => {
      const paths = platform === 'win32' ? windowsPaths() : macPaths();
      const running = executables.map((executable, index) => ({
        pid: index + 1,
        executable,
      }));
      expect(
        processesToQuit(platform, paths, running).map(({ pid }) => pid),
      ).toEqual(expected);
    },
  );
});

describe('parseWindowsProcessList', () => {
  it.each([
    {
      name: 'a command line holding a tab, CRLF line ends and a trailing blank line',
      output:
        '41\tC:\\a b\\x.exe\t"C:\\a b\\x.exe"\targ\r\n52\tD:\\y.exe\t\r\n',
      expected: [
        {
          pid: 41,
          executable: 'C:\\a b\\x.exe',
          commandLine: '"C:\\a b\\x.exe"\targ',
        },
        { pid: 52, executable: 'D:\\y.exe', commandLine: '' },
      ],
    },
    {
      name: 'a process with no ExecutablePath',
      output: '41\t\t\n52\tD:\\y.exe\tD:\\y.exe',
      expected: [
        { pid: 52, executable: 'D:\\y.exe', commandLine: 'D:\\y.exe' },
      ],
    },
    { name: 'no processes', output: '', expected: [] },
  ])(
    'GIVEN $name WHEN parsed THEN the processes are listed',
    ({ output, expected }) => {
      expect(parseWindowsProcessList(output)).toEqual(expected);
    },
  );
});

describe('parseMacProcessList', () => {
  it('GIVEN padded pids, arguments and a blank line WHEN parsed THEN each executable is the first token', () => {
    const output = `  417 ${MAC_BINARY} --flag value\n90210 /bin/zsh\n\n`;
    expect(parseMacProcessList(output)).toEqual([
      {
        pid: 417,
        executable: MAC_BINARY,
        commandLine: `${MAC_BINARY} --flag value`,
      },
      { pid: 90210, executable: '/bin/zsh', commandLine: '/bin/zsh' },
    ]);
  });
});

describe('isInstallDue', () => {
  it('GIVEN a stored hash equal to the lock hash WHEN isInstallDue runs THEN false', () => {
    expect(isInstallDue('abc', 'abc')).toBe(false);
  });

  it('GIVEN no stored hash WHEN isInstallDue runs THEN true', () => {
    expect(isInstallDue('abc', null)).toBe(true);
  });

  it('GIVEN a different stored hash WHEN isInstallDue runs THEN true', () => {
    expect(isInstallDue('abc', 'def')).toBe(true);
  });
});
