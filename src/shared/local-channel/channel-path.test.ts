import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { channelPath } from './channel-path';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function first8HexOfSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

const STABLE = 'wigley-ai-gui';
const DEV = 'wigley-ai-gui-dev';

describe('channelPath', () => {
  it('names the Windows pipe by instance, user and a hash of the home', () => {
    expect(channelPath('windows', 'C:\\Users\\ann', 'ann', STABLE, '')).toMatch(
      /^\\\\\.\\pipe\\wigley-ai-gui-ann-[0-9a-f]{8}$/,
    );
  });

  it('names a different Windows pipe for a different home', () => {
    expect(channelPath('windows', 'C:\\Users\\u', 'u', STABLE, '')).not.toBe(
      channelPath('windows', 'D:\\drive\\home', 'u', STABLE, ''),
    );
  });

  it('puts the socket in the instance folder of the agents folder on macOS', () => {
    expect(channelPath('macos', '/Users/u', 'u', STABLE, '')).toBe(
      '/Users/u/.agents/wigley-ai-gui/app.sock',
    );
  });

  it.each(['windows', 'macos'] as const)(
    'never gives the stable and dev instances one channel on %s',
    (platform) => {
      expect(channelPath(platform, '/Users/u', 'u', STABLE, '')).not.toBe(
        channelPath(platform, '/Users/u', 'u', DEV, ''),
      );
    },
  );

  // 82 bytes of home and 31 of `/.agents/wigley-ai-gui/app.sock`: 113.
  const longHome = `/Users/u/${'d'.repeat(73)}`;
  // `wigley-ai-gui-u-<8 hex>.sock` is 29 bytes, 30 with its `/`.
  const socketName = `wigley-ai-gui-u-${first8HexOfSha256(longHome)}.sock`;

  it('falls back to a per-home socket in the temp folder when it fits in 103 bytes', () => {
    const tempDir = `/T${'t'.repeat(103 - 30 - 2)}`;

    expect(channelPath('macos', longHome, 'u', STABLE, '', tempDir)).toBe(
      `${tempDir}/${socketName}`,
    );
    expect(Buffer.byteLength(`${tempDir}/${socketName}`)).toBe(103);
  });

  // Windows has no /tmp, no process.getuid and no POSIX mode bits.
  it.skipIf(process.platform === 'win32')(
    'falls back to a folder of /tmp only the user can enter when the temp folder socket would be 104 bytes',
    () => {
      const username = `wigley-endpoint-test-${process.pid}`;
      const privateDir = `/tmp/wigley-ai-gui-${username}`;
      folders.push(privateDir);
      const tempDir = `/T${'t'.repeat(104 - 30 - 2)}`;

      const channel = channelPath(
        'macos',
        longHome,
        username,
        STABLE,
        '',
        tempDir,
      );

      expect(channel).toBe(`${privateDir}/${first8HexOfSha256(longHome)}.sock`);
      expect(statSync(privateDir).mode & 0o777).toBe(0o700);
    },
  );

  // Windows has no /tmp, no process.getuid and no POSIX mode bits.
  it.skipIf(process.platform === 'win32')(
    'throws when the /tmp folder exists open to others',
    () => {
      const username = `wigley-endpoint-open-${process.pid}`;
      const privateDir = `/tmp/wigley-ai-gui-${username}`;
      folders.push(privateDir);
      mkdirSync(privateDir, { mode: 0o755 });
      const tempDir = `/T${'t'.repeat(104 - 30 - 2)}`;

      expect(() =>
        channelPath('macos', longHome, username, STABLE, '', tempDir),
      ).toThrow(privateDir);
    },
  );

  const SUFFIX = '-session-host-v1';
  const suffixUser = `wigley-channel-suffix-${process.pid}`;
  const suffixPrivateDir = `/tmp/wigley-ai-gui-${suffixUser}`;
  const shortTemp = '/T';
  const longTemp = `/T${'t'.repeat(104 - 30 - 2)}`;
  const hash = first8HexOfSha256(longHome);
  const suffixCases = [
    {
      form: 'Windows pipe',
      platform: 'windows' as const,
      home: 'C:\\Users\\ann',
      username: 'ann',
      tempDir: shortTemp,
      expected: `\\\\.\\pipe\\wigley-ai-gui-ann-${first8HexOfSha256('C:\\Users\\ann')}${SUFFIX}`,
    },
    {
      form: 'socket',
      platform: 'macos' as const,
      home: '/Users/u',
      username: 'u',
      tempDir: shortTemp,
      expected: '/Users/u/.agents/wigley-ai-gui/app-session-host-v1.sock',
    },
    {
      form: 'temp fallback',
      platform: 'macos' as const,
      home: longHome,
      username: 'u',
      tempDir: shortTemp,
      expected: `/T/wigley-ai-gui-u-${hash}${SUFFIX}.sock`,
    },
    // Windows has no /tmp, no process.getuid and no POSIX mode bits.
    ...(process.platform === 'win32'
      ? []
      : [
          {
            form: 'private fallback',
            platform: 'macos' as const,
            home: longHome,
            username: suffixUser,
            tempDir: longTemp,
            expected: `${suffixPrivateDir}/${hash}${SUFFIX}.sock`,
          },
        ]),
  ];

  it.each(suffixCases)(
    'channelPath_SuffixCases_AddsTheSuffixToEachForm: $form',
    ({ platform, home, username, tempDir, expected }) => {
      folders.push(suffixPrivateDir);

      expect(
        channelPath(platform, home, username, STABLE, SUFFIX, tempDir),
      ).toBe(expected);
    },
  );
});
