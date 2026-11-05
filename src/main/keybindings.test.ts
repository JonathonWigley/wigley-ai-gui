import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../contracts/commands';
import type { Keymap } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { MainCommandContext } from '../contracts/plugin';
import { CommandRegistry } from '../shared/command-registry';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';

const electron = vi.hoisted(() => {
  const templates: MenuItemConstructorOptions[][] = [];
  const shortcuts = new Map<string, () => void>();
  return {
    templates,
    shortcuts,
    Menu: {
      buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
        templates.push(template);
        return {};
      },
      setApplicationMenu: () => {},
    },
    globalShortcut: {
      unregisterAll: () => {},
      register: (accelerator: string, run: () => void) => {
        shortcuts.set(accelerator, run);
        return true;
      },
    },
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

// The key commands of a registry whose every run is recorded.
function recordingCommands(ids: readonly CommandId[]) {
  const registry = new CommandRegistry<MainCommandContext<any>>(() => {});
  const runs: { id: CommandId; context: MainCommandContext<any> }[] = [];
  for (const id of ids) {
    registry.register(id, (context) => void runs.push({ id, context }), 'p');
  }
  const commands: MainCommands = {
    run: (command, arg, extras) =>
      registry.run(command as CommandId, { ...extras, arg }),
    has: (id) => registry.has(id),
    requireRegistered: (each) => registry.requireRegistered(each),
  };
  return { commands, runs };
}

const NO_LOG: Log = () => {};

// A window whose `before-input-event` listener `press` calls.
function fakeWindow() {
  let listener: (event: unknown, input: unknown) => void = () => {};
  const window = {
    webContents: {
      on: (_channel: string, added: typeof listener) => {
        listener = added;
      },
    },
  } as unknown as BrowserWindow;
  return {
    window,
    press(key: string, modifiers: Record<string, boolean>) {
      listener(
        { preventDefault: () => {} },
        {
          type: 'keyDown',
          key,
          control: false,
          alt: false,
          shift: false,
          meta: false,
          ...modifiers,
        },
      );
    },
  };
}

function emptyKeymap(overrides: Partial<Keymap>): Keymap {
  return {
    ...keymapOfAppBind('p.go', 'Alt+Z'),
    app: [],
    ...overrides,
  };
}

function clickFirstCommand() {
  const menu = electron.templates
    .at(-1)
    ?.find((item) => item.label === 'Commands');
  const items = menu?.submenu as MenuItemConstructorOptions[];
  (items[0].click as () => void)();
}

describe('installWindowKeybindings', () => {
  it('menu_InstallAndSetKeymap_LabelsEachBindByLabel', () => {
    const { commands } = recordingCommands(['settings.show', 'docs.open']);
    const window = { webContents: { on: () => {} } };

    const keybindings = installWindowKeybindings(
      window as unknown as BrowserWindow,
      keymapOfAppBind('settings.show', 'CommandOrControl+,'),
      commands,
      (id) => LABELS[id],
      NO_LOG,
    );
    keybindings.setKeymap(keymapOfAppBind('docs.open', 'CommandOrControl+D'));

    expect(electron.templates.map(commandsMenuLabels)).toEqual([
      ['settings (CommandOrControl+,)'],
      ['open a doc (CommandOrControl+D)'],
    ]);
  });

  it('menuClick_Bind_PassesArgAndChord', () => {
    const { commands, runs } = recordingCommands(['p.go']);
    installWindowKeybindings(
      fakeWindow().window,
      emptyKeymap({ app: [{ accelerator: 'Alt+K', command: 'p.go', arg: 3 }] }),
      commands,
      (id) => id,
      NO_LOG,
    );

    clickFirstCommand();

    expect(runs).toEqual([{ id: 'p.go', context: { chord: 'Alt+K', arg: 3 } }]);
  });

  it('intercept_Bind_PassesArgAndChord', () => {
    const { commands, runs } = recordingCommands(['p.go']);
    const { window, press } = fakeWindow();
    installWindowKeybindings(
      window,
      emptyKeymap({
        intercept: [{ key: 'Tab', control: true, command: 'p.go', arg: 3 }],
      }),
      commands,
      (id) => id,
      NO_LOG,
    );

    press('Tab', { control: true });

    expect(runs).toEqual([
      { id: 'p.go', context: { chord: 'Control+Tab', arg: 3 } },
    ]);
  });

  it('global_Bind_PassesArgAndChord', () => {
    const { commands, runs } = recordingCommands(['p.go']);
    registerGlobalShortcuts(
      [{ accelerator: 'Alt+Space', command: 'p.go', arg: 3 }],
      commands,
      NO_LOG,
    );

    electron.shortcuts.get('Alt+Space')?.();

    expect(runs).toEqual([
      { id: 'p.go', context: { chord: 'Alt+Space', arg: 3 } },
    ]);
  });

  it('chord_RuntimeCommandGone_LogsAndRunsNothing', () => {
    const { commands, runs } = recordingCommands([]);
    const logs: string[] = [];

    registerGlobalShortcuts(
      [{ accelerator: 'Alt+Space', command: 'r.gone' }],
      commands,
      (source, message) => void logs.push(`${source}: ${message}`),
    );

    expect(() => electron.shortcuts.get('Alt+Space')?.()).not.toThrow();
    expect(runs).toEqual([]);
    expect(logs).toEqual(['keys: Alt+Space names no command r.gone']);
  });
});
