import { describe, expect, it } from 'vitest';
import { installCommandFor } from './install-command';

describe('installCommandFor', () => {
  it.each([
    {
      os: 'macos' as const,
      exitCodePath:
        "/Users/u/Library/Application Support/it's/install-exit-code",
      command: '/bin/zsh',
      args: [
        '-lc',
        "source ~/.nvm/nvm.sh && nvm use && npm run install-app -- --ref origin/main; echo $? > '/Users/u/Library/Application Support/it'\\''s/install-exit-code'",
      ],
    },
    {
      os: 'windows' as const,
      exitCodePath: "C:\\Users\\u\\AppData\\it's\\install-exit-code",
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "npm.cmd run install-app -- --ref origin/main; $LASTEXITCODE | Out-File -Encoding ascii -FilePath 'C:\\Users\\u\\AppData\\it''s\\install-exit-code'",
      ],
    },
  ])(
    'installCommandFor_$os_QuotesTheExitCodePath',
    ({ os, exitCodePath, command, args }) => {
      expect(installCommandFor(os, exitCodePath)).toEqual({ command, args });
    },
  );

  it('installCommandFor_Linux_Null', () => {
    expect(installCommandFor('linux', '/x')).toBeNull();
  });
});
