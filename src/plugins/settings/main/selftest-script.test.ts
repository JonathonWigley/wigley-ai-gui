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
// test runs; its writes replace the file's layer, refusing with
// `changedOnDisk` when the expected text is not the file's text, as the
// user config service does.
function fakeUserConfig(settings: object, keymap: UserKeymap) {
  let current: UserConfigRead = {
    settings: layerRead<Record<string, unknown>>({ ...settings }),
    keymap: layerRead(keymap),
    themes: [],
    layoutNames: {},
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
  const writeSettings = async (
    layer: Record<string, unknown>,
    expectedText: string | null,
  ) => {
    if (expectedText !== current.settings.text) {
      return { type: 'changedOnDisk' as const };
    }
    set({ settings: layer });
    return { type: 'written' as const };
  };
  return {
    writeSettings,
    userConfig: {
      read: vi.fn(async () => current),
      writeSettings: vi.fn(writeSettings),
      writeKeymap: vi.fn(
        async (layer: UserKeymap, expectedText: string | null) => {
          if (expectedText !== current.keymap.text) {
            return { type: 'changedOnDisk' as const };
          }
          set({ keymap: layer });
          return { type: 'written' as const };
        },
      ),
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

// Whether `result` has settled, read after the test has let pending work land.
function settledFlag(result: Promise<unknown>): () => boolean {
  let isSettled = false;
  const settle = () => {
    isSettled = true;
  };
  result.then(settle, settle);
  return () => isSettled;
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

  it('resolves on the first change after the stale timeout, not before', async () => {
    const fake = fakeUserConfig({}, {});
    const show = vi.fn();
    const script = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    });
    const { result } = script.open(1);
    const isSettled = settledFlag(result);
    await vi.waitFor(() => expect(show).toHaveBeenCalled());

    await fake.change({ settings: {} });
    expect(isSettled()).toBe(false);
    await fake.change({ settings: { keySequenceTimeoutMs: 900 } });
    await fake.change({ keymap: {} });
    expect(isSettled()).toBe(false);
    await fake.change({ settings: {} });

    expect(script.problems(await result)).toEqual([]);
  });

  it('reports a keymap layer the steps left behind', async () => {
    const fake = fakeUserConfig({}, {});
    const show = vi.fn();
    const script = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    });
    const { result } = script.open(1);
    await vi.waitFor(() => expect(show).toHaveBeenCalled());

    await fake.change({ settings: { keySequenceTimeoutMs: 900 } });
    await fake.change({ settings: {}, keymap: { binds: [ADDED_BIND] } });

    expect(script.problems(await result)).toEqual([
      `keymap.json held ${JSON.stringify({ binds: [ADDED_BIND] })}`,
    ]);
  });

  it('empties the files after the previous open has emptied them', async () => {
    const fake = fakeUserConfig({ keySequenceTimeoutMs: 900 }, {});
    let releaseFirstWrite = () => {};
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    fake.userConfig.writeSettings.mockImplementationOnce(
      async (layer, expectedText) => {
        await firstWriteReleased;
        return fake.writeSettings(layer, expectedText);
      },
    );
    const show = vi.fn();
    const script = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    });

    script.open(1);
    await vi.waitFor(() =>
      expect(fake.userConfig.writeSettings).toHaveBeenCalledTimes(1),
    );
    const { result } = script.open(2);
    const isSettled = settledFlag(result);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirstWrite();

    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(isSettled()).toBe(false);
    expect(await fake.userConfig.read()).toMatchObject({
      settings: { layer: {} },
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

  it('resets and shows the mode once when the previous open was refused', async () => {
    const fake = fakeUserConfig(
      { keySequenceTimeoutMs: 900 },
      { binds: [ADDED_BIND] },
    );
    fake.userConfig.writeKeymap.mockResolvedValueOnce({
      type: 'changedOnDisk',
    } as never);
    const show = vi.fn();
    const script = settingsSelfTestScript({
      userConfig: fake.userConfig,
      show,
    });

    const first = script.open(1);
    const second = script.open(2);
    const isSettledSecond = settledFlag(second.result);

    await expect(first.result).rejects.toThrow('changedOnDisk');
    await vi.waitFor(() => expect(show).toHaveBeenCalled());
    expect(show).toHaveBeenCalledTimes(1);
    expect(isSettledSecond()).toBe(false);
    expect(await fake.userConfig.read()).toMatchObject({
      settings: { layer: {} },
      keymap: { layer: {} },
    });
  });
});
