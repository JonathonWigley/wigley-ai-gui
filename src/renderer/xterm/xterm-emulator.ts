import { FitAddon } from '@xterm/addon-fit';
import { type ITheme, Terminal } from '@xterm/xterm';
import xtermStylesheet from '@xterm/xterm/css/xterm.css?url';
import type {
  TerminalEmulator,
  TerminalPalette,
  TerminalScreen,
  TerminalScreenOptions,
  TerminalSize,
} from '../../contracts/terminal-emulator';
import { passesToPage } from './key-rule';

const SCREEN_CLASS = 'terminal-screen';
const START_COLS = 80;
const START_ROWS = 24;
const SCROLLBACK_LINES = 5000;

let stylesheetLinked = false;
// xterm measures its cells when it opens, which needs its stylesheet loaded.
let stylesheetReady = false;
const liveScreens = new Set<TerminalScreen>();

// Links xterm's stylesheet once per document; once it loads, or fails to,
// every live screen fits, which opens any screen whose fit was skipped.
function linkStylesheet(): void {
  if (stylesheetLinked) {
    return;
  }
  stylesheetLinked = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = xtermStylesheet;
  const markReady = (): void => {
    stylesheetReady = true;
    for (const screen of liveScreens) {
      screen.fit();
    }
  };
  link.addEventListener('load', markReady);
  link.addEventListener('error', markReady);
  document.head.append(link);
}

function themeOf(palette: TerminalPalette): ITheme {
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    selectionBackground: palette.selection,
  };
}

function createScreen(options: TerminalScreenOptions): TerminalScreen {
  const element = document.createElement('div');
  element.className = SCREEN_CLASS;
  element.addEventListener('keydown', (event) => {
    if (!passesToPage(event.key)) {
      event.stopPropagation();
    }
  });
  const terminal = new Terminal({
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    theme: themeOf(options.palette),
    cols: START_COLS,
    rows: START_ROWS,
    scrollback: SCROLLBACK_LINES,
  });
  terminal.attachCustomKeyEventHandler((event) => !passesToPage(event.key));
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  let isOpen = false;
  // Output written before xterm opens, laid out at the real width on open.
  let pending = '';
  let isDisposed = false;
  // A focus asked for before xterm opens, applied when it opens.
  let wantsFocus = false;

  const focusOpened = (): void => {
    terminal.focus();
    wantsFocus = false;
  };
  const fit = (): void => {
    const hasBox =
      element.isConnected &&
      element.clientWidth !== 0 &&
      element.clientHeight !== 0;
    if (!stylesheetReady || !hasBox) {
      return;
    }
    if (isOpen) {
      fitAddon.fit();
      return;
    }
    terminal.open(element);
    isOpen = true;
    fitAddon.fit();
    terminal.write(pending);
    pending = '';
    if (wantsFocus) {
      focusOpened();
    }
  };
  const observer = new ResizeObserver(() => fit());
  observer.observe(element);

  const screen: TerminalScreen = {
    element,
    write: (data) => {
      if (isOpen) {
        terminal.write(data);
      } else {
        pending += data;
      }
    },
    onInput: (listener) => terminal.onData(listener),
    onResize: (listener) =>
      terminal.onResize(({ cols, rows }) => listener({ cols, rows })),
    size: (): TerminalSize =>
      isOpen
        ? { cols: terminal.cols, rows: terminal.rows }
        : { cols: START_COLS, rows: START_ROWS },
    fit,
    focus: () => {
      wantsFocus = true;
      fit();
      if (isOpen) {
        focusOpened();
      }
    },
    setPalette: (palette, fontFamily, fontSize) => {
      terminal.options.theme = themeOf(palette);
      terminal.options.fontFamily = fontFamily;
      terminal.options.fontSize = fontSize;
      fit();
    },
    reset: () => {
      if (isOpen) {
        terminal.reset();
      } else {
        pending = '';
      }
    },
    dispose: () => {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      observer.disconnect();
      liveScreens.delete(screen);
      fitAddon.dispose();
      terminal.dispose();
      element.remove();
    },
  };
  liveScreens.add(screen);
  return screen;
}

// The xterm.js adapter behind TerminalEmulator. Each screen opens xterm on its
// first fit with a box, since `create` runs before the caller places it. The
// stylesheet links here, at renderer start, so it has usually loaded by the
// time the first screen is created.
export function createXtermEmulator(): TerminalEmulator {
  linkStylesheet();
  return {
    create: (options) => createScreen(options),
  };
}
