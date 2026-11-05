import {
  type BrowserWindow,
  globalShortcut,
  type Input,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import type { CommandId } from '../contracts/commands';
import type {
  AcceleratorBind,
  InterceptBind,
  Keymap,
} from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { MainCommandContext } from '../contracts/plugin';
import { interceptChordText } from '../shared/accelerator';
import { type KeyCommands, runBound } from '../shared/command-router';
import { errorText } from '../shared/error-text';

// Main-process commands receive the chord that fired them, e.g. `Control+Tab`.
export type MainCommands = KeyCommands<MainCommandContext<any>>;

// Runs `bind` for `chord`.
function runChord(
  bind: { command: CommandId; arg?: unknown },
  chord: string,
  commands: MainCommands,
  log: Log,
) {
  runBound(commands, bind, { keys: chord, source: 'keys', log }, { chord });
}

function buildMenu(
  binds: AcceleratorBind[],
  commands: MainCommands,
  labelOf: (id: CommandId) => string,
  log: Log,
): Menu {
  const items: MenuItemConstructorOptions[] = binds.map((bind) => ({
    label: `${labelOf(bind.command)} (${bind.accelerator})`,
    accelerator: bind.accelerator,
    click: () => runChord(bind, bind.accelerator, commands, log),
  }));
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Commands', submenu: items },
    { role: 'viewMenu' },
  ]);
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

// The window's keymap chords, swapped for a new keymap's.
export interface WindowKeybindings {
  // Rebuilds the app menu and swaps the intercepted chords; throws before
  // changing either when a main-process bind names an unregistered command.
  setKeymap(keymap: Keymap): void;
}

function requireMainCommandsRegistered(keymap: Keymap, commands: MainCommands) {
  commands.requireRegistered(
    [...keymap.app, ...keymap.intercept, ...keymap.global].map(
      (bind) => bind.command,
    ),
  );
}

// The keymap's in-window chords: the app menu's and the intercepted ones, read
// by one input listener from the binds the last keymap set. Checks every
// main-process bind, global ones included, names a registered command.
export function installWindowKeybindings(
  window: BrowserWindow,
  keymap: Keymap,
  commands: MainCommands,
  labelOf: (id: CommandId) => string,
  log: Log,
): WindowKeybindings {
  requireMainCommandsRegistered(keymap, commands);
  Menu.setApplicationMenu(buildMenu(keymap.app, commands, labelOf, log));
  let intercepts = keymap.intercept;
  window.webContents.on('before-input-event', (event, input) => {
    const bind = intercepts.find((candidate) => matchesChord(input, candidate));
    if (!bind) {
      return;
    }
    event.preventDefault();
    runChord(bind, interceptChordText(bind), commands, log);
  });
  return {
    setKeymap(next) {
      requireMainCommandsRegistered(next, commands);
      Menu.setApplicationMenu(buildMenu(next.app, commands, labelOf, log));
      intercepts = next.intercept;
    },
  };
}

// Registers `binds` system-wide, replacing every shortcut an earlier call
// registered. A bind Electron refuses or throws on is logged by its
// accelerator, and the rest still register.
export function registerGlobalShortcuts(
  binds: AcceleratorBind[],
  commands: MainCommands,
  log: Log,
) {
  globalShortcut.unregisterAll();
  for (const bind of binds) {
    try {
      const registered = globalShortcut.register(bind.accelerator, () =>
        runChord(bind, bind.accelerator, commands, log),
      );
      if (!registered) {
        log('global', `${bind.accelerator} is taken by another app`);
      }
    } catch (error) {
      log('global', `${bind.accelerator} not registered: ${errorText(error)}`);
    }
  }
}
