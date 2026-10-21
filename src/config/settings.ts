import type { Settings } from '../contracts/settings';

export const defaultSettings: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'catppuccin-mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: '~/.local/bin/claude' },
};
