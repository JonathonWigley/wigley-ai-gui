import { describe, expect, it } from 'vitest';
import { defaultSettingsFor } from './settings';

describe('defaultSettingsFor', () => {
  it('defaultSettingsFor_Programs_SetsClaudeCommand', () => {
    expect(defaultSettingsFor({ claude: '/x/claude' }).claude.command).toBe(
      '/x/claude',
    );
  });

  it('defaultSettingsFor_PluginsDisabled_HoldsDocsSessionTab', () => {
    expect(
      defaultSettingsFor({ claude: '/x/claude' }).plugins.disabled,
    ).toContain('docs-session-tab');
  });
});
