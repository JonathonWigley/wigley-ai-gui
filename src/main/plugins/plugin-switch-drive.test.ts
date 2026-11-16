import { describe, expect, it } from 'vitest';
import type { UserConfigRead } from '../../contracts/user-config';
import { fakeDriveHost } from '../../shared/fake-drive-host';
import { addPluginSwitchActions } from './plugin-switch-drive';

const IDS = ['agent-lines', 'gallery'];

// `calls` records `reload <id>` and `settled`; `reload` rejects
// `No plugin "<id>"` for an id `reloadable` does not hold.
function setup(
  layer: Record<string, unknown>,
  disabled: readonly string[],
  reloadable: readonly string[] = IDS,
) {
  const drive = fakeDriveHost();
  const writes: [Record<string, unknown>, string | null][] = [];
  const calls: string[] = [];
  const text = JSON.stringify(layer);
  addPluginSwitchActions(drive.host, {
    pluginSwitch: {
      restart: async () => undefined,
      settled: async () => {
        calls.push('settled');
      },
    },
    userConfig: {
      read: async (): Promise<UserConfigRead> => ({
        settings: { state: 'ok', layer, text },
        keymap: { state: 'ok', layer: null, text: null },
        themes: [],
        layoutNames: {},
      }),
      async writeSettings(written, expectedText) {
        writes.push([written, expectedText]);
        return { type: 'written' };
      },
    },
    ids: () => IDS,
    async reload(id) {
      calls.push(`reload ${id}`);
      if (!reloadable.includes(id)) {
        throw new Error(`No plugin "${id}"`);
      }
    },
    disabled: () => disabled,
  });
  return { drive, writes, calls, text };
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
    {
      action: 'stopPlugin',
      args: {},
      expected: 'stopPlugin takes { id: string }',
    },
    { action: 'stopPlugin', args: { id: 'zzz' }, expected: 'No plugin "zzz"' },
    {
      action: 'reloadPlugin',
      args: { name: 'u' },
      expected: 'reloadPlugin takes { id: string }',
    },
    { action: 'reloadPlugin', args: { id: 'zz' }, expected: 'No plugin "zz"' },
  ])(
    'args_BadOrUnknown_Rejects: $action $expected',
    async ({ action, args, expected }) => {
      const { drive, writes, calls } = setup({}, []);

      await expect(drive.run(action, args)).rejects.toThrow(expected);
      expect(writes).toEqual([]);
      expect(calls).not.toContain('settled');
    },
  );

  it.each([
    { case: 'an id the config holds', id: 'gallery' },
    { case: 'an id the config does not hold', id: 'u' },
  ])('reloadPlugin_ReloadsThenWaitsForTheSwitch: $case', async ({ id }) => {
    const { drive, calls } = setup({}, [], [...IDS, 'u']);

    const result = await drive.run('reloadPlugin', { id });

    expect(result).toBe(null);
    expect(calls).toEqual([`reload ${id}`, 'settled']);
  });
});
