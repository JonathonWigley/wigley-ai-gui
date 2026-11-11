import { type Files, isMissingFile } from '../../../contracts/files';

// The install's log, the file its command line writes its exit code to, and
// the commit of the build that started it, in the plugin's data folder.
export const INSTALL_LOG_FILE = 'install.log';
export const INSTALL_EXIT_CODE_FILE = 'install-exit-code';
export const INSTALL_FROM_COMMIT_FILE = 'install-from-commit';

// How many of the log's last lines a failure shows.
const ERROR_LINES = 12;

// A finished install: its exit code and the last lines of its log.
export interface InstallResult {
  code: number;
  logTail: string;
}

// `start` empties the log and the exit-code file, starts the install program
// and records `fromCommit`, resolving once it has started; it rejects when the
// program cannot start. `result` is the finished install's, null while it
// still runs or when none was started. `startedFrom` is the commit of the
// build that started the last install, null when none did.
export interface Installer {
  start(): Promise<void>;
  result(): Promise<InstallResult | null>;
  startedFrom(): Promise<string | null>;
}

// `data` is the plugin's data folder; `fromCommit` the running build's
// commit; `startProgram` starts the install program detached, its output
// appended to `INSTALL_LOG_FILE` there, and its command line writes its exit
// code to `INSTALL_EXIT_CODE_FILE` there.
export interface InstallerDeps {
  data: Files;
  fromCommit: string;
  startProgram(): Promise<void>;
}

export function createInstaller(deps: InstallerDeps): Installer {
  const { data } = deps;
  return {
    async start() {
      await data.write(INSTALL_EXIT_CODE_FILE, '');
      await data.write(INSTALL_LOG_FILE, '');
      // Written once the program runs: a start that failed leaves no install
      // for a later start to wait on.
      await data.write(INSTALL_FROM_COMMIT_FILE, '');
      await deps.startProgram();
      await data.write(INSTALL_FROM_COMMIT_FILE, deps.fromCommit);
    },
    async startedFrom() {
      const commit = (await readOrEmpty(data, INSTALL_FROM_COMMIT_FILE)).trim();
      return commit === '' ? null : commit;
    },
    async result() {
      const codeText = (await readOrEmpty(data, INSTALL_EXIT_CODE_FILE)).trim();
      const code = Number(codeText);
      if (codeText === '' || !Number.isInteger(code)) {
        return null;
      }
      return {
        code,
        logTail: logTail(code, await readOrEmpty(data, INSTALL_LOG_FILE)),
      };
    },
  };
}

// The file's text; empty when it is missing.
async function readOrEmpty(data: Files, path: string): Promise<string> {
  try {
    return await data.read(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return '';
    }
    throw error;
  }
}

// The log's last non-blank lines, or the exit code alone for an empty log.
function logTail(code: number, log: string): string {
  const lines = log.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length === 0
    ? `install-app exited ${String(code)}`
    : lines.slice(-ERROR_LINES).join('\n');
}
