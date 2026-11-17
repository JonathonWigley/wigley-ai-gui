import type { LoginStart, LoginStartStatus } from '../contracts/login-start';

// A LoginStart that records each `set` in `calls` and resolves to the status
// the last `answer` gave; before any `answer`, to `on` or `off` as asked.
export interface FakeLoginStart extends LoginStart {
  readonly calls: boolean[];
  answer(status: LoginStartStatus): void;
}

export function createFakeLoginStart(): FakeLoginStart {
  const calls: boolean[] = [];
  let answered: LoginStartStatus | null = null;
  return {
    calls,
    answer(status) {
      answered = status;
    },
    async set(on) {
      calls.push(on);
      return answered ?? { state: on ? 'on' : 'off', detail: null };
    },
  };
}
