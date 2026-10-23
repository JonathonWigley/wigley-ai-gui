import { describe, expect, it, vi } from 'vitest';
import type { UserKeymap } from '../../../contracts/keymap';
import type {
  ConfigFileRead,
  UserConfigRead,
} from '../../../contracts/user-config';
import { settingsSelfTestScript } from './selftest-script';

function layerRead<L>(layer: L): ConfigFileRead<L> {
  return { state: 'ok', layer, text: JSON.stringify(layer) };
}

// A user config whose files the test sets, and whose change listeners the
// test runs; its writes replace the file's layer.
function fakeUserConfig(settings: object, keymap: UserKeymap) {
  let current: UserConfigRead = {
    settings: layerRead<Record<string, unknown>>({ ...settings }),
    keymap: layerRead(keymap),
    themes: [],
  };
  const listeners = new Set<() => void>();
  const set = (next: { settings?: object; keymap?: UserKeymap }) => {
    current = {
      ...current,
      ...(next.settings === undefined
        ? {}
        : {
            settings: layerRead<Record<string, unknown>>({ ...next.settings }),
          }),
      ...(next.keymap === undefined ? {} : { keymap: layerRead(next.keymap) }),
    };
  };
  return {
    userConfig: {
      read: async () => current,
      writeSettings: vi.fn(async (layer: Record<string, unknown>) => {
        set({ settings: layer });
        return { type: 'written' as const };
      }),
      writeKeymap: vi.fn(async (layer: UserKeymap) => {
        set({ keymap: layer });
        return { type: 'written' as const };
      }),
      onChanged(listener: () => void) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    // Sets the files and tells every listener, as the config store does.
    async change(next: { settings?: object; keymap?: UserKeymap }) {
      set(next);
      for (const listener of listeners) {
        listener();
      }
      // Lets each listener's read land.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const ADDED_BIND = {
  keys: '<Leader>zh',
  scope: 'any',
  command: 'keys.toggleHelp',
} as const;

async function isSettled(result: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  const settled = await Promise.race([
    result.then(
      () => true,
      () => true,
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), 20)),
  ]);
  return settled !== pending;
}

describe('settingsSelfTestScript', () => {
  it('empties files a run before left, then shows the mode', async () => {
    const fake = fakeUserConfig(
      { keySequenceTimeoutMs: 900 },
      { binds: [ADDED_BIND] },
    );
    const show = vi.fn();

    settingsSelfTestScript({ userConfig: fake.userConfig, show }).open(1);

    await vi.waitFor(() => expect(show).toHaveBeenCalled());
    expect(await fake.userConfig.read()).toMatchObject({
      settings: { layer: {} },
      keymap: { layer: {} },
    });
  });

  it('resolves on the first empty config after the added bind, not before', async () => {
    const fake = fakeUserConfig({}, {});
    const show = vi.fn();
    const { result } = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    }).open(1);
    await vi.waitFor(() => expect(show).toHaveBeenCalled());

    await fake.change({ settings: {} });
    expect(await isSettled(result)).toBe(false);
    await fake.change({ keymap: { binds: [ADDED_BIND] } });
    await fake.change({ keymap: {}, settings: { keySequenceTimeoutMs: 900 } });
    expect(await isSettled(result)).toBe(false);
    await fake.change({ settings: {} });

    expect(await result).toMatchObject({
      settings: { layer: {} },
      keymap: { layer: {} },
    });
  });

  it('rejects when emptying the files is refused', async () => {
    const fake = fakeUserConfig({}, {});
    fake.userConfig.writeKeymap.mockResolvedValueOnce({
      type: 'changedOnDisk',
    } as never);
    const show = vi.fn();

    const { result } = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    }).open(1);

    await expect(result).rejects.toThrow('changedOnDisk');
    expect(show).not.toHaveBeenCalled();
  });
});
