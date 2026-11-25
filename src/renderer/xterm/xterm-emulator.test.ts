import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalScreenOptions } from '../../contracts/terminal-emulator';

// xterm needs a real layout engine to open, so the adapter runs here over a
// recording `Terminal` and a stub document; what is under test is the
// adapter's own pre-open logic, which decides when xterm opens and what it
// is told.
const xterm = vi.hoisted(() => ({
  terminals: [] as {
    calls: string[];
    cols: number;
    rows: number;
  }[],
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    readonly calls: string[] = [];
    cols = 80;
    rows = 24;
    options = {};
    constructor() {
      xterm.terminals.push(this);
    }
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {
      this.calls.push('open');
    }
    write(data: string) {
      this.calls.push(`write:${data}`);
    }
    focus() {
      this.calls.push('focus');
    }
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}));
vi.mock('@xterm/xterm/css/xterm.css?url', () => ({ default: 'xterm.css' }));

const OPTIONS: TerminalScreenOptions = {
  fontFamily: 'mono',
  fontSize: 13,
  palette: {
    background: '#000',
    foreground: '#fff',
    cursor: '#fff',
    selection: '#333',
  },
};

class StubElement {
  isConnected = false;
  clientWidth = 0;
  clientHeight = 0;
  className = '';
  private listeners = new Map<string, () => void>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  fire(type: string) {
    this.listeners.get(type)?.();
  }
  remove() {
    this.isConnected = false;
  }
  append() {}
}

async function setup() {
  vi.resetModules();
  xterm.terminals.length = 0;
  const links: StubElement[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const element = new StubElement();
      if (tag === 'link') {
        links.push(element);
      }
      return element;
    },
    head: { append: () => {} },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { createXtermEmulator } = await import('./xterm-emulator');
  const emulator = createXtermEmulator();
  const screen = emulator.create(OPTIONS);
  const element = screen.element as unknown as StubElement;
  return {
    screen,
    links,
    calls: () => xterm.terminals[0].calls,
    // The page places the screen with a box.
    place() {
      element.isConnected = true;
      element.clientWidth = 800;
      element.clientHeight = 400;
    },
    loadStylesheet: () => links[0].fire('load'),
  };
}

describe('xterm emulator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createXtermEmulator_BeforeAnyScreen_LinksTheStylesheet', async () => {
    vi.resetModules();
    const links: StubElement[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const element = new StubElement();
        links.push(element);
        return element;
      },
      head: { append: () => {} },
    });
    const { createXtermEmulator } = await import('./xterm-emulator');
    createXtermEmulator();
    expect(links).toHaveLength(1);
  });

  it.each(['placed first', 'loaded first'] as const)(
    'focus_AskedBeforeOpen_FocusesWhenTheScreenOpens (%s)',
    async (order) => {
      const t = await setup();
      t.screen.focus();
      expect(t.calls()).toEqual([]);
      if (order === 'placed first') {
        t.place();
        t.loadStylesheet();
      } else {
        t.loadStylesheet();
        t.place();
        t.screen.fit();
      }
      expect(t.calls()).toEqual(['open', 'write:', 'focus']);
    },
  );

  it('focus_NeverAsked_OpensWithoutFocusing', async () => {
    const t = await setup();
    t.place();
    t.loadStylesheet();
    expect(t.calls()).not.toContain('focus');
  });

  it('focus_AfterOpen_FocusesAtOnce', async () => {
    const t = await setup();
    t.place();
    t.loadStylesheet();
    t.screen.focus();
    expect(t.calls().filter((call) => call === 'focus')).toHaveLength(1);
  });

  it('write_BeforeOpen_IsHeldAndWrittenOnOpen', async () => {
    const t = await setup();
    t.screen.write('one ');
    t.screen.write('two');
    expect(t.calls()).toEqual([]);
    t.place();
    t.loadStylesheet();
    expect(t.calls()).toEqual(['open', 'write:one two']);
  });

  it('reset_BeforeOpen_DropsTheHeldOutput', async () => {
    const t = await setup();
    t.screen.write('stale');
    t.screen.reset();
    t.place();
    t.loadStylesheet();
    expect(t.calls()).toEqual(['open', 'write:']);
  });

  it('size_BeforeOpen_IsTheStartSize', async () => {
    const t = await setup();
    expect(t.screen.size()).toEqual({ cols: 80, rows: 24 });
  });
});
