import { describe, expect, it } from 'vitest';
import { coreDefaultSettings } from './settings';

describe('coreDefaultSettings', () => {
  it.each(['docs-session-tab', 'unity-pool'])(
    'coreDefaultSettings_PluginsDisabled_Holds: %s',
    (plugin) => {
      expect(coreDefaultSettings().plugins.disabled).toContain(plugin);
    },
  );

  // A non-empty default makes the merge check each user group against the
  // default's element, and the bar stops following plugin places out of the box.
  it('coreDefaultSettings_ShellActivityBar_StartsEmpty', () => {
    expect(coreDefaultSettings().shell.activityBar).toEqual({
      groups: [],
      hidden: [],
    });
  });
});
