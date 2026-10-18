import {
  type BrowserWindow,
  globalShortcut,
  type Input,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import type {
  AcceleratorBind,
  InterceptBind,
  Keymap,
} from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { CommandRegistry } from '../shared/command-registry';

// Main-process commands receive the chord that fired them, e.g. `Control+Tab`.
export type MainCommands = CommandRegistry<string>;

function buildMenu(binds: AcceleratorBind[], commands: MainCommands): Menu {
  const items: MenuItemConstructorOptions[] = binds.map((bind) => ({
    label: `${bind.command} (${bind.accelerator})`,
    accelerator: bind.accelerator,
    click: () => commands.run(bind.command, bind.accelerator),
  }));
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Commands', submenu: items },
    { role: 'viewMenu' },
  ]);
}

function chordName(bind: InterceptBind): string {
  const modifiers = [
    bind.control && 'Control',
    bind.alt && 'Alt',
    bind.shift && 'Shift',
    bind.meta && 'Command',
  ].filter(Boolean);
  return [...modifiers, bind.key].join('+');
}

function matchesChord(input: Input, bind: InterceptBind): boolean {
  const isKeyDown = input.type === 'keyDown' && input.key === bind.key;
  const modifiersMatch =
    input.control === Boolean(bind.control) &&
    input.alt === Boolean(bind.alt) &&
    input.shift === Boolean(bind.shift) &&
    input.meta === Boolean(bind.meta);
  return isKeyDown && modifiersMatch;
}

function interceptChords(
  window: BrowserWindow,
  binds: InterceptBind[],
  commands: MainCommands,
) {
  window.webContents.on('before-input-event', (event, input) => {
    const bind = binds.find((candidate) => matchesChord(input, candidate));
    if (!bind) {
      return;
    }
    event.preventDefault();
    commands.run(bind.command, chordName(bind));
  });
}

// The keymap's in-window chords: the app menu's and the intercepted ones.
// Checks every main-process bind, global ones included, names a registered
// command.
export function installWindowKeybindings(
  window: BrowserWindow,
  keymap: Keymap,
  commands: MainCommands,
) {
  commands.requireRegistered(
    [...keymap.app, ...keymap.intercept, ...keymap.global].map(
      (bind) => bind.command,
    ),
  );
  Menu.setApplicationMenu(buildMenu(keymap.app, commands));
  interceptChords(window, keymap.intercept, commands);
}

export function registerGlobalShortcuts(
  binds: AcceleratorBind[],
  commands: MainCommands,
  log: Log,
) {
  for (const bind of binds) {
    const registered = globalShortcut.register(bind.accelerator, () =>
      commands.run(bind.command, bind.accelerator),
    );
    if (!registered) {
      log('global', `${bind.accelerator} is taken by another app`);
    }
  }
}
