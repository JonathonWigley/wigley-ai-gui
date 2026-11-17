import { describe, expect, it } from 'vitest';
import { coreDefaultSettings } from './settings';

describe('coreDefaultSettings', () => {
  it('coreDefaultSettings_PluginsDisabled_HoldsDocsSessionTab', () => {
    expect(coreDefaultSettings().plugins.disabled).toContain(
      'docs-session-tab',
    );
  });
});
