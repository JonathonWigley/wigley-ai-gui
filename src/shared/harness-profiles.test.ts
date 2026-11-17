import { describe, expect, it } from 'vitest';
import type { AgentHarnessInfo } from '../contracts/agent';
import { harnessInfo } from './agent-harness-registry.test-support';
import { registeredProfiles } from './harness-profiles';

describe('registeredProfiles', () => {
  it('registeredProfiles_TwoHarnesses_SlotOrderThenProfileOrder', () => {
    const infos = new Map<string, AgentHarnessInfo>([
      [
        'b',
        harnessInfo({
          profiles: [
            { name: 'x', configDir: '/x' },
            { name: 'y', configDir: '/y' },
          ],
        }),
      ],
      ['a', harnessInfo({ profiles: [{ name: 'z', configDir: '/z' }] })],
    ]);

    expect(registeredProfiles(infos)).toEqual([
      { harnessId: 'b', name: 'x', configDir: '/x' },
      { harnessId: 'b', name: 'y', configDir: '/y' },
      { harnessId: 'a', name: 'z', configDir: '/z' },
    ]);
    expect(registeredProfiles(new Map())).toEqual([]);
  });
});
