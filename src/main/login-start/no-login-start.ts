import type { LoginStart } from '../../contracts/login-start';

// The LoginStart of a run that does not start the host at login: every `set` answers `unsupported` and changes nothing.
export function createNoLoginStart(): LoginStart {
  return {
    set: async () => ({ state: 'unsupported', detail: null }),
  };
}
