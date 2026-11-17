import { describe, expect, it } from 'vitest';
import type { LoginStartStatus } from '../contracts/login-start';
import { createFakeLoginStart } from './fake-login-start';

const NEEDS_APPROVAL: LoginStartStatus = {
  state: 'needsApproval',
  detail: 'x',
};

describe('createFakeLoginStart', () => {
  it.each<{
    name: string;
    answer: LoginStartStatus | null;
    expected: [LoginStartStatus, LoginStartStatus];
  }>([
    {
      name: 'before any answer, set follows on',
      answer: null,
      expected: [
        { state: 'on', detail: null },
        { state: 'off', detail: null },
      ],
    },
    {
      name: 'after an answer, set resolves that status',
      answer: NEEDS_APPROVAL,
      expected: [NEEDS_APPROVAL, NEEDS_APPROVAL],
    },
  ])('$name', async ({ answer, expected }) => {
    const loginStart = createFakeLoginStart();
    if (answer !== null) {
      loginStart.answer(answer);
    }

    const statuses = [await loginStart.set(true), await loginStart.set(false)];

    expect({ statuses, calls: loginStart.calls }).toEqual({
      statuses: expected,
      calls: [true, false],
    });
  });
});
