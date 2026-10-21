import type { Settings } from '../contracts/settings';

export const defaultSettings: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'catppuccin-mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: '~/.local/bin/claude' },
};

// The JSON kind of each core setting `defaultSettings` leaves unset, by its
// dotted path, so a `settings.json` may set it.
export const optionalSettings: Readonly<
  Record<string, 'string' | 'number' | 'boolean'>
> = {
  'fonts.ui': 'string',
  'fonts.mono': 'string',
  'fonts.uiSize': 'number',
  'fonts.monoSize': 'number',
};

// The only strings a core setting takes, by its dotted path.
export const settingChoices: Readonly<Record<string, readonly string[]>> = {
  transparency: ['system', 'full', 'reduced'],
};
