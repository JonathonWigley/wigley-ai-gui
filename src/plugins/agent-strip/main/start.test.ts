import { describe, expect, it } from 'vitest';
import type { SelfTestScript } from '../../../contracts/plugin';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentStripMainPart } from './start';

describe('agentStripMainPart', () => {
  it('start_RegistersLayoutsAndHandsScript', () => {
    const registered: unknown[] = [];
    const scripts: SelfTestScript[] = [];
    let disposedLayouts = 0;
    const api = {
      layouts: {
        register: (registration: unknown) => {
          registered.push(registration);
          return {
            dispose: () => {
              disposedLayouts += 1;
            },
          };
        },
      },
      services: {
        homeDir: '/home',
        selfTest: { run: (script: SelfTestScript) => scripts.push(script) },
      },
      dependency: () => ({}),
    } as unknown as Parameters<typeof agentStripMainPart.start>[0];

    const started = agentStripMainPart.start(api);
    const disposedBefore = disposedLayouts;
    void started.dispose?.();

    expect(registered).toEqual([{ layoutTypes }]);
    expect(scripts).toHaveLength(1);
    expect(disposedBefore).toBe(0);
    expect(disposedLayouts).toBe(1);
  });
});
