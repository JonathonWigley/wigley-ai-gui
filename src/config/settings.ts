import type { SettingInfos } from '../contracts/plugin';
import type { Settings } from '../contracts/settings';

export const defaultSettings: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'catppuccin-mocha',
  transparency: 'system',
  fonts: {},
  keySequenceTimeoutMs: 1000,
  claude: { command: '~/.local/bin/claude' },
  shell: { layout: 'default' },
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
  'fonts.proseSize': 'number',
};

// The only strings a core setting takes, by its dotted path.
export const settingChoices: Readonly<Record<string, readonly string[]>> = {
  transparency: ['system', 'full', 'reduced'],
};

// Each core setting's row in Settings mode, by its dotted path.
export const settingInfo: SettingInfos<Settings> = {
  'window.width': {
    label: 'Window width',
    description:
      'Width of a new window, in pixels. Applies to the next window.',
  },
  'window.height': {
    label: 'Window height',
    description:
      'Height of a new window, in pixels. Applies to the next window.',
  },
  'window.minWidth': {
    label: 'Minimum window width',
    description:
      'The narrowest the window can be dragged, in pixels. Applies to the next window.',
  },
  'window.minHeight': {
    label: 'Minimum window height',
    description:
      'The shortest the window can be dragged, in pixels. Applies to the next window.',
  },
  theme: {
    label: 'Theme',
    description: 'A built-in theme or one from the themes folder.',
  },
  transparency: {
    label: 'Transparency',
    description:
      'Whether glass shows through: follow the system, always, or never.',
  },
  'fonts.ui': {
    label: 'UI font',
    description: "A font family for the interface, in place of the theme's.",
  },
  'fonts.mono': {
    label: 'Code font',
    description:
      "A font family for code, paths and keys, in place of the theme's.",
  },
  'fonts.uiSize': {
    label: 'UI font size',
    description: 'The interface text size, in pixels.',
  },
  'fonts.monoSize': {
    label: 'Code font size',
    description: 'The code text size, in pixels.',
  },
  'fonts.proseSize': {
    label: 'Prose font size',
    description: 'The size of rendered markdown text, in pixels.',
  },
  keySequenceTimeoutMs: {
    label: 'Key sequence timeout',
    description:
      'How long a key sequence waits for its next key, in milliseconds.',
  },
  'claude.command': {
    label: 'Claude command',
    description:
      'The `claude` program sessions run; `~` is the home folder. Applies to the next session.',
  },
  'shell.layout': {
    label: 'Shell layout',
    description:
      'The layout that draws the title bar, activity bar, side bar and status bar: a folder in the layouts/shell folder, or default.',
  },
};
