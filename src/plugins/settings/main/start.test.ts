import { describe, expect, it } from 'vitest';
import type { UserConfig } from '../../../contracts/user-config';
import {
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { settingsMainPart } from './start';

// A user config holding only its `onChanged` listeners, in `liveListeners`.
function listenerUserConfig() {
  const liveListeners = new Set<() => void>();
  const userConfig = {
    onChanged(listener: () => void) {
      liveListeners.add(listener);
      return { dispose: () => liveListeners.delete(listener) };
    },
  } as unknown as UserConfig;
  return { userConfig, liveListeners };
}

describe('settings main part', () => {
  it('stops with nothing live and starts again', async () => {
    const { userConfig, liveListeners } = listenerUserConfig();
    const harness = startMainPart(settingsMainPart, {
      services: { userConfig },
    });

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);
    expect(liveListeners.size).toBe(0);

    await harness.restart();
    expect(liveListeners.size).toBe(1);
    await harness.stop();
  });

  it('mayDisable_AnswersThroughThePluginSwitch', async () => {
    const heard: string[] = [];
    const harness = startMainPart(settingsMainPart, {
      services: {
        userConfig: listenerUserConfig().userConfig,
        pluginSwitch: {
          mayDisable: async (pluginId) => {
            heard.push(pluginId);
            return 'x';
          },
        },
      },
    });

    await expect(harness.invoke('mayDisable', 'gallery')).resolves.toBe('x');
    expect(heard).toEqual(['gallery']);
    await harness.stop();
  });
});
