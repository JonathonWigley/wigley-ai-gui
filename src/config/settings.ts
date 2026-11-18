import type { SettingInfos, SettingPath } from '../contracts/plugin';
import type { Settings } from '../contracts/settings';

export function coreDefaultSettings(): Settings {
  return {
    window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
    theme: 'catppuccin-mocha',
    transparency: 'system',
    fonts: {},
    keySequenceTimeoutMs: 1000,
    shell: { layout: 'default' },
    plugins: {
      disabled: ['agent-lines', 'usage-tab-line', 'docs-session-tab'],
    },
    programs: { python: '' },
  };
}

// The JSON kind of each core setting `coreDefaultSettings` leaves unset, by its
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

// The id of the control kind a core setting's row draws with, by its dotted
// path, for a setting the default rules would give another kind.
export const settingControls: Readonly<
  Partial<Record<SettingPath<Settings>, string>>
> = { 'shell.layout': 'layout' };

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
  'shell.layout': {
    label: 'Shell layout',
    description:
      'The layout that draws the title bar, activity bar, side bar, right bar and status bar: a folder in the layouts/shell folder, or default.',
  },
  'plugins.disabled': {
    label: 'Disabled plugins',
    description:
      'Plugin ids the app does not run. A change applies at once: the app stops each plugin the list adds and starts each one it drops. Settings mode switches them in its Plugins section.',
  },
  'programs.python': {
    label: 'Python command',
    description:
      'The Python the docs index and unity-pool run: a program name or a path; ~ is the home folder. Empty, the app looks on PATH for py -3, python, then python3 on Windows, and python3, then python elsewhere. Applies to the next run.',
  },
};
