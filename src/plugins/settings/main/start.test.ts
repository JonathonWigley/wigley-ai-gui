import { describe, expect, it } from 'vitest';
import type { UserConfig } from '../../../contracts/user-config';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { settingsMainPart } from './start';

describe('settings main part', () => {
  it('stops with nothing live and starts again', async () => {
    const liveListeners = new Set<() => void>();
    const userConfig = {
      onChanged(listener: () => void) {
        liveListeners.add(listener);
        return { dispose: () => liveListeners.delete(listener) };
      },
    } as unknown as UserConfig;
    const harness = startMainPart(settingsMainPart, {
      services: { userConfig },
    });

    await harness.stop();
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
    expect(liveListeners.size).toBe(0);

    await harness.restart();
    expect(liveListeners.size).toBe(1);
    await harness.stop();
  });
});
