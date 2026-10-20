import { describe, expect, it } from 'vitest';
import type {
  ChannelShape,
  MainChannel,
  MainServices,
  PluginManifest,
} from '../../contracts/plugin';
import { createEventBus } from '../../shared/event-bus';
import { createMemoryFiles } from '../../shared/memory-files';
import { createMainApi } from './main-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: [],
  commands: {},
  scopes: {},
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: {},
};

describe('createMainApi', () => {
  it('gives the plugin events under its id', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('p.x', (data) => heard.push(data));
    const api = createMainApi(manifest, {
      channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
      settings: {},
      services: {} as MainServices,
      dependency: <E>() => undefined as E,
      bus,
      dataRoot: '/d',
    });

    api.events.emit('x', 3);

    expect(heard).toEqual([3]);
  });

  it('createMainApi_Data_IsScopedToThePluginFolder', async () => {
    const files = createMemoryFiles();
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        settings: {},
        services: { files } as unknown as MainServices,
        dependency: <E>() => undefined as E,
        bus: createEventBus(),
        dataRoot: '/d',
      },
    );

    await api.data.write('x.txt', 'text');

    expect(await files.read('/d/forms/x.txt')).toBe('text');
    await expect(api.data.write('../x.txt', 'text')).rejects.toThrow(
      '../x.txt is outside /d/forms',
    );
  });
});
