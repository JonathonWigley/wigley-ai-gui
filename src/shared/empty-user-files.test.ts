import { describe, expect, it, vi } from 'vitest';
import type { UserKeymap } from '../contracts/keymap';
import type { ConfigFileRead, UserConfigRead } from '../contracts/user-config';
import { emptyUserFiles } from './empty-user-files';

function layerRead<L>(layer: L): ConfigFileRead<L> {
  return { state: 'ok', layer, text: JSON.stringify(layer) };
}

// A user config whose writes replace the file's layer, refusing with
// `changedOnDisk` when the expected text is not the file's text, as the user
// config service does.
function fakeUserConfig(settings: object, keymap: UserKeymap) {
  let current: UserConfigRead = {
    settings: layerRead<Record<string, unknown>>({ ...settings }),
    keymap: layerRead(keymap),
    themes: [],
  };
  const writeSettings = async (
    layer: Record<string, unknown>,
    expectedText: string | null,
  ) => {
    if (expectedText !== current.settings.text) {
      return { type: 'changedOnDisk' as const };
    }
    current = { ...current, settings: layerRead({ ...layer }) };
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
          current = { ...current, keymap: layerRead(layer) };
          return { type: 'written' as const };
        },
      ),
    },
  };
}

const ADDED_BIND = {
  keys: '<Leader>zh',
  scope: 'any',
  command: 'keys.toggleHelp',
} as const;

describe('emptyUserFiles', () => {
  it('reads for an overlapping call only after the previous call wrote', async () => {
    const fake = fakeUserConfig(
      { keySequenceTimeoutMs: 900 },
      { binds: [ADDED_BIND] },
    );
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

    const first = emptyUserFiles(fake.userConfig);
    const second = emptyUserFiles(fake.userConfig);
    await vi.waitFor(() =>
      expect(fake.userConfig.writeSettings).toHaveBeenCalledTimes(1),
    );
    releaseFirstWrite();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(await fake.userConfig.read()).toMatchObject({
      settings: { layer: {} },
      keymap: { layer: {} },
    });
  });

  it('empties the files for a call after one whose write was refused', async () => {
    const fake = fakeUserConfig(
      { keySequenceTimeoutMs: 900 },
      { binds: [ADDED_BIND] },
    );
    fake.userConfig.writeKeymap.mockResolvedValueOnce({
      type: 'changedOnDisk',
    } as never);

    const first = emptyUserFiles(fake.userConfig);
    const second = emptyUserFiles(fake.userConfig);

    await expect(first).rejects.toThrow('changedOnDisk');
    await expect(second).resolves.toBeUndefined();
    expect(await fake.userConfig.read()).toMatchObject({
      settings: { layer: {} },
      keymap: { layer: {} },
    });
  });
});
