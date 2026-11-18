import { describe, expect, it } from 'vitest';
import type { LoginStartStatus } from '../../contracts/login-start';
import {
  createAgentServiceLoginStart,
  type LoginItems,
} from './agent-service-login-start';

type LoginItemSettings = Parameters<LoginItems['setLoginItemSettings']>[0];

// A LoginItems whose `getLoginItemSettings` answers `statuses` in turn, repeating the last, and that records each
// `setLoginItemSettings` call.
function fakeLoginItems(statuses: readonly (string | undefined)[]) {
  const calls: LoginItemSettings[] = [];
  let reads = 0;
  const loginItems: LoginItems = {
    setLoginItemSettings: (settings) => {
      calls.push(settings);
    },
    getLoginItemSettings: () => ({
      status: statuses[Math.min(reads++, statuses.length - 1)],
    }),
  };
  return { loginItems, calls };
}

const APPROVAL: LoginStartStatus = {
  state: 'needsApproval',
  detail: 'Turn on Auri in System Settings > General > Login Items.',
};
const NOT_FOUND: LoginStartStatus = {
  state: 'off',
  detail: 'This build has no session host login item.',
};

describe('createAgentServiceLoginStart', () => {
  it.each<{
    status: string | undefined;
    on: boolean;
    expected: LoginStartStatus;
  }>([
    { status: 'enabled', on: true, expected: { state: 'on', detail: null } },
    { status: 'enabled', on: false, expected: { state: 'on', detail: null } },
    { status: 'requires-approval', on: true, expected: APPROVAL },
    { status: 'requires-approval', on: false, expected: APPROVAL },
    {
      status: 'not-registered',
      on: true,
      expected: { state: 'off', detail: 'The login item did not register.' },
    },
    {
      status: 'not-registered',
      on: false,
      expected: { state: 'off', detail: null },
    },
    { status: 'not-found', on: true, expected: NOT_FOUND },
    { status: 'not-found', on: false, expected: NOT_FOUND },
    {
      status: 'locked',
      on: true,
      expected: { state: 'off', detail: 'Login start failed: locked' },
    },
    {
      status: 'locked',
      on: false,
      expected: { state: 'off', detail: 'Login start failed: locked' },
    },
  ])(
    'reads status $status after set($on) as $expected.state',
    async ({ status, on, expected }) => {
      const { loginItems } = fakeLoginItems([status]);

      expect(await createAgentServiceLoginStart(loginItems).set(on)).toEqual(
        expected,
      );
    },
  );

  it.each<{ on: boolean; before: string; calls: LoginItemSettings[] }>([
    { on: true, before: 'enabled', calls: [] },
    {
      on: true,
      before: 'not-registered',
      calls: [
        {
          openAtLogin: true,
          type: 'agentService',
          serviceName: 'wigley-ai-gui.session-host.plist',
        },
      ],
    },
    { on: false, before: 'not-registered', calls: [] },
    {
      on: false,
      before: 'enabled',
      calls: [
        {
          openAtLogin: false,
          type: 'agentService',
          serviceName: 'wigley-ai-gui.session-host.plist',
        },
      ],
    },
  ])(
    'registers only when the status is not what set($on) asks (was $before)',
    async ({ on, before, calls }) => {
      const fake = fakeLoginItems([before, on ? 'enabled' : 'not-registered']);

      await createAgentServiceLoginStart(fake.loginItems).set(on);

      expect(fake.calls).toEqual(calls);
    },
  );

  it('resolves to off when the call throws', async () => {
    const { loginItems } = fakeLoginItems(['not-registered']);
    loginItems.setLoginItemSettings = () => {
      throw new Error('service refused');
    };

    expect(await createAgentServiceLoginStart(loginItems).set(true)).toEqual({
      state: 'off',
      detail: 'Login start failed: service refused',
    });
  });
});
