import type {
  AccountStatus,
  AgentHarness,
  HarnessProfile,
  LogInEvents,
  LogInProcess,
} from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import type { ChatChannel } from '../contract';
import { requireProfile } from './lookups';

// Each profile's sign-in, by profile name. One sign-in runs at a time, named
// by the id the page gave it: its link and its end reach the page as
// `logInLink` and `logInEnded`, carrying that id. A cancelled sign-in stops
// running at once, and its later events are logged and reach no page. A name
// chat has no profile for rejects (`logIn` throws), naming it.
export interface Accounts {
  status(profile: string): Promise<AccountStatus>;
  // Throws while a sign-in runs, starting none.
  logIn(id: number, profile: string): void;
  // Passes the code to sign-in `id`; logged and ignored when it is not the
  // running one.
  sendCode(id: number, code: string): void;
  // Cancels sign-in `id`; logged and ignored when it is not the running one.
  cancel(id: number): void;
  // Cancels the running sign-in, if any, for when the page that started it is
  // gone.
  cancelRunning(): void;
  logOut(profile: string): Promise<void>;
}

interface RunningLogIn {
  id: number;
  profile: string;
  process: LogInProcess;
}

// `harness` is looked up on every call and throws when chat's harness is
// missing.
export function createAccounts(deps: {
  harness(): AgentHarness;
  profiles(): readonly HarnessProfile[];
  send: MainChannel<ChatChannel>['send'];
  log: PluginLog;
}): Accounts {
  const { send, log } = deps;
  let running: RunningLogIn | null = null;

  const configDirOf = (name: string) =>
    requireProfile(deps.profiles(), name).configDir;

  // `isRunning` tells whether this sign-in is still the running one; a newer
  // page may reuse an older page's id, so it compares the run, not the id.
  function logInEvents(
    id: number,
    profile: string,
    isRunning: () => boolean,
  ): LogInEvents {
    return {
      link(url) {
        if (!isRunning()) {
          log(
            `sign-in link for ${profile} dropped: that sign-in was cancelled`,
          );
          return;
        }
        send('logInLink', { id, profile, url });
      },
      ended({ status, error }) {
        log(
          `sign-in for ${profile} ended${error === null ? '' : `: ${error}`}`,
        );
        if (!isRunning()) {
          return;
        }
        running = null;
        send('logInEnded', { id, profile, status, error });
      },
    };
  }

  // The running sign-in when it is `id`; logs `ignored` otherwise.
  function runningAs(id: number, ignored: string): RunningLogIn | null {
    if (running?.id !== id) {
      log(`${ignored} for sign-in ${id}, which is not running, ignored`);
      return null;
    }
    return running;
  }

  function stop(run: RunningLogIn) {
    running = null;
    log(`sign-in for ${run.profile} cancelled`);
    run.process.cancel();
  }

  return {
    async status(profile) {
      return deps.harness().accountStatus(configDirOf(profile));
    },
    logIn(id, profile) {
      const configDir = configDirOf(profile);
      if (running !== null) {
        log(`sign-in for ${profile} refused: one runs for ${running.profile}`);
        throw new Error(`A sign-in is already running for ${running.profile}`);
      }
      // Set before any event: the harness emits none inside `logIn`.
      let run: RunningLogIn | null = null;
      const process = deps.harness().logIn(
        configDir,
        logInEvents(id, profile, () => running !== null && running === run),
      );
      run = { id, profile, process };
      running = run;
      log(`sign-in for ${profile} started`);
    },
    sendCode(id, code) {
      runningAs(id, 'sign-in code')?.process.sendCode(code);
    },
    cancel(id) {
      const run = runningAs(id, 'sign-in cancel');
      if (run !== null) {
        stop(run);
      }
    },
    cancelRunning() {
      if (running !== null) {
        stop(running);
      }
    },
    async logOut(profile) {
      await deps.harness().logOut(configDirOf(profile));
      log(`signed out ${profile}`);
    },
  };
}
