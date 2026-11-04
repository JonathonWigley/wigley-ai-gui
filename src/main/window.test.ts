import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainCommands } from './keybindings';
import { registerWindowCommands, windowService } from './window';

const electron = vi.hoisted(() => ({
  app: { show: vi.fn(), focus: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('electron', () => electron);

const PNG = new Uint8Array([1, 2, 3]);

// A window whose calls throw once it is destroyed, as Electron's do.
function fakeWindow({ isDestroyed }: { isDestroyed: boolean }) {
  const shown: string[] = [];
  const live = <T>(value: T): T => {
    if (isDestroyed) {
      throw new TypeError('Object has been destroyed');
    }
    return value;
  };
  const window = {
    isDestroyed: () => isDestroyed,
    isFocused: () => live(true),
    show: () => shown.push(live('show')),
    focus: () => shown.push(live('focus')),
    get webContents() {
      return live({
        capturePage: async () => ({ isEmpty: () => false, toPNG: () => PNG }),
      });
    },
  };
  return { window: window as unknown as BrowserWindow, shown };
}

describe('windowService', () => {
  beforeEach(() => {
    electron.dialog.showOpenDialog.mockReset();
    electron.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/w/chosen'],
    });
  });

  it('destroyedWindow_AnswersWithoutThrowing', async () => {
    const { window, shown } = fakeWindow({ isDestroyed: true });
    const service = windowService(window);

    service.show();

    expect(shown).toEqual([]);
    expect(service.isFocused()).toBe(false);
    await expect(service.chooseFolder()).resolves.toBeNull();
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
    await expect(service.capture()).rejects.toThrow('capture is empty');
  });

  it('liveWindow_UsesTheWindow', async () => {
    const { window, shown } = fakeWindow({ isDestroyed: false });
    const service = windowService(window);

    service.show();

    expect(shown).toEqual(['show', 'focus']);
    expect(service.isFocused()).toBe(true);
    await expect(service.chooseFolder()).resolves.toBe('/w/chosen');
    await expect(service.capture()).resolves.toBe(PNG);
  });
});

describe('registerWindowCommands', () => {
  it('summon_DestroyedWindow_DoesNothing', () => {
    const handlers = new Map<string, (chord: string) => void>();
    const commands = {
      register: (name: string, handler: (chord: string) => void) =>
        handlers.set(name, handler),
    } as unknown as MainCommands;
    const { window, shown } = fakeWindow({ isDestroyed: true });
    const log = vi.fn();
    registerWindowCommands(commands, window, log);

    handlers.get('window.summon')?.('chord');

    expect(shown).toEqual([]);
    expect(electron.app.show).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
