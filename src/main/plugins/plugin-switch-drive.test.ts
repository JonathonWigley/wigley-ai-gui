import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../../contracts/plugin';
import type { UserConfigRead } from '../../contracts/user-config';
import { fakeDriveHost } from '../../shared/fake-drive-host';
import { addPluginSwitchActions } from './plugin-switch-drive';

function manifest(id: string): PluginManifest {
  return {
    id,
    label: id,
    description: 'A test plugin.',
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  };
}

const MANIFESTS = [manifest('agent-lines'), manifest('gallery')];

function setup(layer: Record<string, unknown>, disabled: readonly string[]) {
  const drive = fakeDriveHost();
  const writes: [Record<string, unknown>, string | null][] = [];
  const text = JSON.stringify(layer);
  addPluginSwitchActions(drive.host, {
    pluginSwitch: { restart: async () => undefined },
    userConfig: {
      read: async (): Promise<UserConfigRead> => ({
        settings: { state: 'ok', layer, text },
        keymap: { state: 'ok', layer: null, text: null },
        themes: [],
      }),
      async writeSettings(written, expectedText) {
        writes.push([written, expectedText]);
        return { type: 'written' };
      },
    },
    manifests: MANIFESTS,
    disabled: () => disabled,
  });
  return { drive, writes, text };
}

describe('addPluginSwitchActions', () => {
  it.each([
    {
      case: 'stop adds the id to the list the config serves',
      layer: {},
      disabled: ['agent-lines'],
      action: 'stopPlugin',
      written: { plugins: { disabled: ['agent-lines', 'gallery'] } },
    },
    {
      case: 'start drops the id from the file list',
      layer: { plugins: { disabled: ['gallery'] } },
      disabled: ['agent-lines'],
      action: 'startPlugin',
      written: { plugins: { disabled: [] } },
    },
  ])('stopAndStart_WriteThePluginList: $case', async (row) => {
    const { drive, writes, text } = setup(row.layer, row.disabled);

    const result = await drive.run(row.action, { id: 'gallery' });

    expect(result).toEqual({ type: 'written' });
    expect(writes).toEqual([[row.written, text]]);
  });

  it.each([
    { args: {}, expected: 'stopPlugin takes { id: string }' },
    { args: { id: 'zzz' }, expected: 'No plugin "zzz"' },
  ])('args_BadOrUnknown_Rejects: $expected', async ({ args, expected }) => {
    const { drive, writes } = setup({}, []);

    await expect(drive.run('stopPlugin', args)).rejects.toThrow(expected);
    expect(writes).toEqual([]);
  });
});
