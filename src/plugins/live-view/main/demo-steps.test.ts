import { describe, expect, it, vi } from 'vitest';

import type { DemoMainContext, DemoMainStep } from '../../../contracts/demo';
import type { MainServices } from '../../../contracts/plugin';
import type { ScreenAccess } from '../../../contracts/screen-capture';
import {
  createFakeScreenCapture,
  FAKE_EDITOR_PROCESS_ID,
} from '../../../shared/fake-screen-capture';
import type { LivePick } from '../contract';
import { registerDemoSteps } from './demo-steps';

// The step registered over a fake capture with `access`, entered once; the
// picks it set, and whether it listed windows.
async function enterStep(access: ScreenAccess) {
  const capture = createFakeScreenCapture({ access });
  const listWindows = vi.fn(capture.listWindows);
  const set: [string, LivePick][] = [];
  let step: DemoMainStep | null = null;
  const services = {
    demoSteps: {
      register(registered: DemoMainStep) {
        step = registered;
        return { dispose() {} };
      },
    },
  } as unknown as MainServices;
  registerDemoSteps(services, {
    screenCapture: { access: capture.access, listWindows },
    picks: {
      set: (session, pick) => set.push([session, pick]),
      delete: () => {},
    },
    ownProcessId: FAKE_EDITOR_PROCESS_ID,
    log: () => {},
  });
  const context = {
    launchSession: async () => 's1',
  } as unknown as DemoMainContext;
  await step!.enter(context);
  return { set, listWindows };
}

describe('registerDemoSteps', () => {
  it.each([
    { access: 'undetermined' as const, lists: false, kind: 'blocked' },
    { access: 'blocked' as const, lists: true, kind: 'blocked' },
    { access: 'granted' as const, lists: true, kind: 'stream' },
  ])(
    'enter_ByAccess_ListsOnlyWhenAsked: $access',
    async ({ access, lists, kind }) => {
      const { set, listWindows } = await enterStep(access);

      expect(listWindows.mock.calls.length > 0).toBe(lists);
      expect(set.map(([session, pick]) => [session, pick.kind])).toEqual([
        ['s1', kind],
      ]);
    },
  );
});
