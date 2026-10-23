import type {
  AccountStatus,
  AgentHarness,
  LogInEvents,
  LogInProcess,
} from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import type { ChatChannel, ChatProfile } from '../contract';
import { requireProfile } from './chat-sessions';

// Each profile's sign-in, by profile name. One sign-in runs at a time: its
// link and its end reach the page as `logInLink` and `logInEnded`. A name
// chat has no profile for rejects (`logIn` throws), naming it.
export interface Accounts {
  status(profile: string): Promise<AccountStatus>;
  // Throws while a sign-in runs, starting none.
  logIn(profile: string): void;
  // Passes the code to the running sign-in; logged and ignored when none runs.
  sendCode(code: string): void;
  // Cancels the running sign-in; logged and ignored when none runs.
  cancel(): void;
  logOut(profile: string): Promise<void>;
}

interface RunningLogIn {
  profile: string;
  process: LogInProcess;
}

// `harness` is looked up on every call and throws when chat's harness is
// missing.
export function createAccounts(deps: {
  harness(): AgentHarness;
  profiles(): readonly ChatProfile[];
  send: MainChannel<ChatChannel>['send'];
  log: Log;
}): Accounts {
  const { send, log } = deps;
  let running: RunningLogIn | null = null;

  const configDirOf = (name: string) =>
    requireProfile(deps.profiles(), name).configDir;

  // Only the running sign-in emits: the next starts after its `ended`.
  function logInEvents(profile: string): LogInEvents {
    return {
      link(url) {
        send('logInLink', { profile, url });
      },
      ended({ status, error }) {
        running = null;
        log(
          'chat',
          `sign-in for ${profile} ended${error === null ? '' : `: ${error}`}`,
        );
        send('logInEnded', { profile, status, error });
      },
    };
  }

  return {
    async status(profile) {
      return deps.harness().accountStatus(configDirOf(profile));
    },
    logIn(profile) {
      const configDir = configDirOf(profile);
      if (running !== null) {
        log(
          'chat',
          `sign-in for ${profile} refused: one runs for ${running.profile}`,
        );
        throw new Error(`A sign-in is already running for ${running.profile}`);
      }
      const process = deps.harness().logIn(configDir, logInEvents(profile));
      running = { profile, process };
      log('chat', `sign-in for ${profile} started`);
    },
    sendCode(code) {
      if (running === null) {
        log('chat', 'sign-in code with no sign-in running ignored');
        return;
      }
      running.process.sendCode(code);
    },
    cancel() {
      if (running === null) {
        log('chat', 'sign-in cancel with no sign-in running ignored');
        return;
      }
      log('chat', `sign-in for ${running.profile} cancelled`);
      running.process.cancel();
    },
    async logOut(profile) {
      await deps.harness().logOut(configDirOf(profile));
      log('chat', `signed out ${profile}`);
    },
  };
}
