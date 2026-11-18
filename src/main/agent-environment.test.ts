import { describe, expect, it } from 'vitest';
import { agentEnvironmentOf } from './agent-environment';

describe('agentEnvironmentOf', () => {
  // `ProcessRunner.spawn` passes the environment through whole, so an
  // undefined value kept here would reach `child_process`.
  it.each([
    {
      given: 'an undefined value',
      env: { KEEP: 'a', DROP: undefined },
      expected: { KEEP: 'a', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    },
    {
      given: 'an endpoint folder already set',
      env: { WIGLEY_AI_GUI_ENDPOINT_DIR: '/other' },
      expected: { WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    },
  ])(
    'agentEnvironmentOf_KeepsDefinedValuesAndSetsThisEndpoint given $given',
    ({ env, expected }) => {
      expect(agentEnvironmentOf(env, '/e')).toEqual(expected);
    },
  );
});
