import { describe, expect, it } from 'vitest';
import type {
  ChannelShape,
  MainChannel,
  MainServices,
  PluginManifest,
} from '../../contracts/plugin';
import { createEventBus } from '../../shared/event-bus';
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
    });

    api.events.emit('x', 3);

    expect(heard).toEqual([3]);
  });
});
