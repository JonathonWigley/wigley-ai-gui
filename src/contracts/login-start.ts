export type LoginStartState = 'on' | 'off' | 'needsApproval' | 'unsupported';
// `detail` says why, for the line Schedules mode shows: the approval step, a failure's reason; null otherwise.
export interface LoginStartStatus {
  state: LoginStartState;
  detail: string | null;
}
// Starts the session host when the user logs in, so its pending runs fire after a restart with no app open.
export interface LoginStart {
  // Registers the login start when `on` is true, removes it when false; resolves to the state after. Rewrites a
  // registration that differs from what this build would write. Never rejects: a failure is `off` with `detail`.
  set(on: boolean): Promise<LoginStartStatus>;
}
