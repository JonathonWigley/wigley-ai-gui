import { describe, expect, it } from 'vitest';
import { coreDefaultSettings } from './settings';

describe('coreDefaultSettings', () => {
  it.each(['docs-session-tab', 'unity-pool'])(
    'coreDefaultSettings_PluginsDisabled_Holds: %s',
    (plugin) => {
      expect(coreDefaultSettings().plugins.disabled).toContain(plugin);
    },
  );
});
