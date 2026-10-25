import { describe, expect, it } from 'vitest';
import {
  installPaths,
  isInstallDue,
  parseInstallArgs,
} from './install-steps.mts';

const USAGE = 'usage: npm run install-app -- [--ref <ref>]';

const WINDOWS_ENV = {
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
};

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
    const paths = installPaths(
      'win32',
      'x64',
      'D:\\ai-dev\\wigley-ai-gui',
      WINDOWS_ENV,
    );
    expect(paths).toEqual({
      buildDir: 'D:\\ai-dev\\.wigley-ai-gui-build',
      packagedDir:
        'D:\\ai-dev\\.wigley-ai-gui-build\\out\\wigley-ai-gui-win32-x64',
      installDir: 'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui',
      binary:
        'C:\\Users\\me\\AppData\\Local\\Programs\\wigley-ai-gui\\wigley-ai-gui.exe',
      shortcut:
        'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Auri.lnk',
    });
  });

  it('GIVEN darwin, arm64 WHEN installPaths runs THEN installDir is /Applications/wigley-ai-gui.app and shortcut null', () => {
    const paths = installPaths(
      'darwin',
      'arm64',
      '/Users/me/ai-dev/wigley-ai-gui',
      {},
    );
    expect(paths).toEqual({
      buildDir: '/Users/me/ai-dev/.wigley-ai-gui-build',
      packagedDir:
        '/Users/me/ai-dev/.wigley-ai-gui-build/out/wigley-ai-gui-darwin-arm64',
      installDir: '/Applications/wigley-ai-gui.app',
      binary: '/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui',
      shortcut: null,
    });
  });

  it('GIVEN linux WHEN installPaths runs THEN it throws the pinned message', () => {
    expect(() =>
      installPaths('linux', 'x64', '/home/me/wigley-ai-gui', {}),
    ).toThrow('install-app supports Windows and macOS, not linux');
  });

  it('GIVEN win32 with no LOCALAPPDATA WHEN installPaths runs THEN it throws the pinned message', () => {
    expect(() =>
      installPaths('win32', 'x64', 'D:\\ai-dev\\wigley-ai-gui', {
        APPDATA: WINDOWS_ENV.APPDATA,
      }),
    ).toThrow('install-app needs LOCALAPPDATA and APPDATA set');
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
