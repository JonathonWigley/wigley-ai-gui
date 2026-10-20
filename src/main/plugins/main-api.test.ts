import { describe, expect, it } from 'vitest';
import type {
  ChannelShape,
  MainChannel,
  MainServices,
  PluginManifest,
  SelfTestHost,
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
      selfTestFor: () => null,
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
        selfTestFor: () => null,
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

  it('createMainApi_SelfTest_IsTheHostForThePlugin', () => {
    const host: SelfTestHost = { run: () => undefined };
    const clock = { now: () => 0 };
    const askedFor: string[] = [];
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        settings: {},
        services: {
          files: createMemoryFiles(),
          clock,
        } as unknown as MainServices,
        selfTestFor: (pluginId) => {
          askedFor.push(pluginId);
          return host;
        },
        dependency: <E>() => undefined as E,
        bus: createEventBus(),
        dataRoot: '/d',
      },
    );

    expect(askedFor).toEqual(['forms']);
    expect(api.services.selfTest).toBe(host);
    expect(api.services.clock).toBe(clock);
  });
});
