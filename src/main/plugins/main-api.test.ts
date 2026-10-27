import { describe, expect, it } from 'vitest';
import type {
  ChannelShape,
  DriveHost,
  MainChannel,
  MainServices,
  PluginManifest,
  SelfTestHost,
} from '../../contracts/plugin';
import { createEventBus } from '../../shared/event-bus';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createMainApi } from './main-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: [],
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

const fixedSettings = {
  pluginSettings: () => ({ p: {} }),
  onPluginSettingsChanged: () => ({ dispose: () => undefined }),
};

// Settings deps whose value `change` replaces, calling every listener.
function liveSettings(initial: Record<string, object>) {
  let current = initial;
  const listeners = new Set<(settings: Record<string, object>) => void>();
  return {
    deps: {
      pluginSettings: () => current,
      onPluginSettingsChanged: (
        listener: (settings: Record<string, object>) => void,
      ) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    change(next: Record<string, object>) {
      current = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

function apiOver(settings: ReturnType<typeof liveSettings>) {
  return createMainApi(manifest, {
    channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
    ...settings.deps,
    services: { paths: posixPaths } as MainServices,
    selfTestFor: () => null,
    driveFor: () => null,
    dependency: <E>() => undefined as E,
    bus: createEventBus(),
    dataRoot: '/d',
  });
}

describe('createMainApi', () => {
  it("settings() reads the plugin's current settings", () => {
    const settings = liveSettings({ p: { size: 1 }, q: { size: 2 } });
    const api = apiOver(settings);

    settings.change({ p: { size: 3 }, q: { size: 2 } });

    expect(api.settings()).toEqual({ size: 3 });
  });

  it("onSettingsChanged fires only when that plugin's settings change", () => {
    const settings = liveSettings({ p: { size: 1 }, q: { size: 2 } });
    const heard: object[] = [];
    apiOver(settings).onSettingsChanged((next) => heard.push(next));

    settings.change({ p: { size: 1 }, q: { size: 5 } });
    settings.change({ p: { size: 4 }, q: { size: 5 } });

    expect(heard).toEqual([{ size: 4 }]);
  });

  it('gives the plugin events under its id', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('p.x', (data) => heard.push(data));
    const api = createMainApi(manifest, {
      channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
      ...fixedSettings,
      services: { paths: posixPaths } as MainServices,
      selfTestFor: () => null,
      driveFor: () => null,
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
        ...fixedSettings,
        services: { files, paths: posixPaths } as unknown as MainServices,
        selfTestFor: () => null,
        driveFor: () => null,
        dependency: <E>() => undefined as E,
        bus: createEventBus(),
        dataRoot: '/d',
      },
    );

    await api.data.write('x.txt', 'text');

    expect(await files.read('/d/forms/x.txt')).toBe('text');
    await expect(api.data.write('../x.txt', 'text')).rejects.toThrow(
      '../x.txt',
    );
  });

  it('createMainApi_SelfTest_IsTheHostForThePlugin', () => {
    const host: SelfTestHost = { run: () => undefined };
    const clock = { now: () => 0 };
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        ...fixedSettings,
        services: {
          files: createMemoryFiles(),
          clock,
          paths: posixPaths,
        } as unknown as MainServices,
        selfTestFor: (pluginId) => (pluginId === 'forms' ? host : null),
        driveFor: () => null,
        dependency: <E>() => undefined as E,
        bus: createEventBus(),
        dataRoot: '/d',
      },
    );

    expect(api.services.selfTest).toBe(host);
    expect(api.services.clock).toBe(clock);
  });

  it('hands each plugin its own drive host', () => {
    const formsHost: DriveHost = { add: () => ({ dispose: () => undefined }) };
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        ...fixedSettings,
        services: {
          files: createMemoryFiles(),
          paths: posixPaths,
        } as unknown as MainServices,
        selfTestFor: () => null,
        driveFor: (pluginId) => (pluginId === 'forms' ? formsHost : null),
        dependency: <E>() => undefined as E,
        bus: createEventBus(),
        dataRoot: '/d',
      },
    );

    expect(api.drive).toBe(formsHost);
  });
});
