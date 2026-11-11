import type { OsName } from '../../../contracts/platform';

// A program and its args, run with no shell of the app's own.
export interface CommandLine {
  command: string;
  args: string[];
}

// The ref the install builds.
const INSTALL_REF = 'origin/main';

// The command line that installs origin's `main` from the clone it runs in,
// then writes its exit code to `exitCodePath`, a full path; null on an OS
// `npm run install-app` does not install on.
export function installCommandFor(
  os: OsName,
  exitCodePath: string,
): CommandLine | null {
  if (os === 'macos') {
    // A login shell, since an app started from the Dock has no nvm on its PATH.
    return {
      command: '/bin/zsh',
      args: [
        '-lc',
        `source ~/.nvm/nvm.sh && nvm use && npm run install-app -- --ref ${INSTALL_REF}; echo $? > ${shellQuoted(exitCodePath)}`,
      ],
    };
  }
  if (os === 'windows') {
    // Untested on Windows. `npm.cmd`, since PowerShell's own `npm.ps1` shim
    // drops the `--` before `--ref`; ASCII, since Windows PowerShell's default
    // file encoding writes a byte order mark. `$LASTEXITCODE` stays null when
    // `npm.cmd` cannot start, which would write a blank line the plugin reads
    // as still running, so null writes 1.
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `npm.cmd run install-app -- --ref ${INSTALL_REF}; $(if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }) | Out-File -Encoding ascii -FilePath ${powerShellQuoted(exitCodePath)}`,
      ],
    };
  }
  return null;
}

// A POSIX shell single-quoted string, which expands nothing; `'` ends the
// quote, is escaped, and opens it again.
function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

// A PowerShell single-quoted string, which expands nothing; `'` doubles.
function powerShellQuoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
