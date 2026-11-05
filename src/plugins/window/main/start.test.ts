import { describe, expect, it, vi } from 'vitest';
import type { MainServices } from '../../../contracts/plugin';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { windowMainPart } from './start';

function startPart(cameForward: boolean) {
  const summon = vi.fn(() => cameForward);
  const window: MainServices['window'] = {
    show() {},
    summon,
    isFocused: () => false,
    chooseFolder: async () => null,
    capture: async () => new Uint8Array(),
  };
  const harness = startMainPart(windowMainPart, { services: { window } });
  return { harness, summon };
}

describe('window main part', () => {
  it('summon_WindowComesForward_LogsTheChord', () => {
    const { harness, summon } = startPart(true);

    harness.started().commands.summon('Alt+Space');

    expect(summon).toHaveBeenCalledOnce();
    expect(harness.logs).toEqual([
      { source: 'window', message: 'Alt+Space summoned the window' },
    ]);
  });

  it('summon_WindowDestroyed_LogsNothing', () => {
    const { harness } = startPart(false);

    harness.started().commands.summon('Alt+Space');

    expect(harness.logs).toEqual([]);
  });
});
