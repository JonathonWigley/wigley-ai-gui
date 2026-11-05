import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offscreenWindowService, windowService } from './window';

const electron = vi.hoisted(() => ({
  app: { show: vi.fn(), focus: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('electron', () => electron);

const PNG = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  electron.app.show.mockReset();
  electron.app.focus.mockReset();
});

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

  it('summon_DestroyedWindow_DoesNothing', () => {
    const { window, shown } = fakeWindow({ isDestroyed: true });

    expect(windowService(window).summon()).toBe(false);

    expect(shown).toEqual([]);
    expect(electron.app.show).not.toHaveBeenCalled();
  });

  it('summon_LiveWindow_ShowsAndStealsFocus', () => {
    const { window, shown } = fakeWindow({ isDestroyed: false });
    electron.app.show.mockImplementation(() => shown.push('app.show'));
    electron.app.focus.mockImplementation(() => shown.push('app.focus'));

    expect(windowService(window).summon()).toBe(true);

    expect(shown).toEqual(['app.show', 'show', 'app.focus']);
    expect(electron.app.focus).toHaveBeenCalledWith({ steal: true });
  });
});

describe('offscreenWindowService', () => {
  it('show_LeavesTheWindowHiddenAndUnfocused', () => {
    const { window, shown } = fakeWindow({ isDestroyed: false });
    const log = vi.fn();

    offscreenWindowService(window, 'the self-test', log).show();

    expect(shown).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      'main',
      'window not shown in the self-test',
    );
  });

  it('chooseFolder_OpensNoDialog', async () => {
    electron.dialog.showOpenDialog.mockReset();
    const { window } = fakeWindow({ isDestroyed: false });
    const service = offscreenWindowService(window, 'the self-test', vi.fn());

    await expect(service.chooseFolder()).resolves.toBeNull();
    expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('summon_Offscreen_LogsAndStaysBack', () => {
    const { window, shown } = fakeWindow({ isDestroyed: false });
    const log = vi.fn();

    const result = offscreenWindowService(
      window,
      'the self-test',
      log,
    ).summon();

    expect(result).toBe(false);
    expect(shown).toEqual([]);
    expect(electron.app.show).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'main',
      'window not summoned in the self-test',
    );
  });
});
