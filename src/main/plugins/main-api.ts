import type {
  ChannelShape,
  MainApi,
  MainServices,
  PluginManifest,
} from '../../contracts/plugin';
import type { PluginChannels } from './plugin-channel';

// `settings` is the plugin's merged settings; `dependency` is the host's.
export interface MainApiDeps {
  channels: PluginChannels;
  settings: object;
  services: MainServices;
  dependency<E>(pluginId: string): E;
}

export function createMainApi(
  manifest: PluginManifest,
  deps: MainApiDeps,
): MainApi<PluginManifest, ChannelShape> {
  return {
    channel: deps.channels.forPlugin(manifest.id),
    settings: deps.settings,
    services: deps.services,
    dependency: deps.dependency,
  };
}
