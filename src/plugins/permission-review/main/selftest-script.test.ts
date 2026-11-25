import { describe, expect, it } from 'vitest';
import type { FakeAgentHarness } from '../../../shared/fake-agent-harness';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { permissionReviewSelfTestScript } from './selftest-script';

// The permission-review script over fakes whose session runs on a fake harness
// that rejects its permission request with `rejection`, logging what the
// script logs.
function setUp(rejection: Error) {
  const logged: string[] = [];
  const fake = {
    failNextAsk: () => undefined,
    askPermission: () => Promise.reject(rejection),
  } as unknown as FakeAgentHarness;
  const script = permissionReviewSelfTestScript({
    homeDir: '/home/me',
    files: {
      realPath: (target) => Promise.resolve(target),
      makeFolder: () => Promise.resolve(),
    },
    paths: posixPaths,
    chat: {
      closeSessionsIn: () => Promise.resolve(),
      launch: () => Promise.resolve('s-1'),
    },
    sessions: { activate: () => undefined },
    log: (line) => logged.push(line),
    fakeOf: () => fake,
  });
  return { script, logged };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('permissionReviewSelfTestScript', () => {
  it('open_PermissionRequestRejects_LogsWhy', async () => {
    const { script, logged } = setUp(new Error('no process record'));

    await script.open(1).result;
    await settle();

    expect(logged).toEqual([
      'self-test permission request failed: no process record',
    ]);
  });
});
