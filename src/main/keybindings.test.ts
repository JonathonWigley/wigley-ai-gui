import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../contracts/commands';
import type { Keymap } from '../contracts/keymap';
import { CommandRegistry } from '../shared/command-registry';
import { installWindowKeybindings } from './keybindings';

const electron = vi.hoisted(() => {
  const templates: MenuItemConstructorOptions[][] = [];
  return {
    templates,
    Menu: {
      buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
        templates.push(template);
        return {};
      },
      setApplicationMenu: () => {},
    },
    globalShortcut: {},
  };
});
vi.mock('electron', () => electron);

beforeEach(() => {
  electron.templates.length = 0;
});

const LABELS: Record<CommandId, string> = {
  'settings.show': 'settings',
  'docs.open': 'open a doc',
};

function keymapOfAppBind(command: CommandId, accelerator: string): Keymap {
  return {
    editor: { leader: ' ', remaps: [], binds: [] },
    page: [],
    app: [{ command, accelerator }],
    intercept: [],
    global: [],
    groups: {},
  };
}

function commandsMenuLabels(template: MenuItemConstructorOptions[]) {
  const menu = template.find((item) => item.label === 'Commands');
  const items = menu?.submenu as MenuItemConstructorOptions[];
  return items.map((item) => item.label);
}

describe('installWindowKeybindings', () => {
  it('menu_InstallAndSetKeymap_LabelsEachBindByLabel', () => {
    const commands = new CommandRegistry<string>();
    commands.register('settings.show', () => {});
    commands.register('docs.open', () => {});
    const window = { webContents: { on: () => {} } };

    const keybindings = installWindowKeybindings(
      window as unknown as BrowserWindow,
      keymapOfAppBind('settings.show', 'CommandOrControl+,'),
      commands,
      (id) => LABELS[id],
    );
    keybindings.setKeymap(keymapOfAppBind('docs.open', 'CommandOrControl+D'));

    expect(electron.templates.map(commandsMenuLabels)).toEqual([
      ['settings (CommandOrControl+,)'],
      ['open a doc (CommandOrControl+D)'],
    ]);
  });
});
