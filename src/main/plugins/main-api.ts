import type {
  ChannelShape,
  EventShape,
  MainApi,
  MainServices,
  PluginManifest,
} from '../../contracts/plugin';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import type { PluginChannels } from './plugin-channel';

// `settings` is the plugin's merged settings; `dependency` is the host's;
// `bus` is shared by every main part.
export interface MainApiDeps {
  channels: PluginChannels;
  settings: object;
  services: MainServices;
  dependency<E>(pluginId: string): E;
  bus: EventBus;
}

export function createMainApi(
  manifest: PluginManifest,
  deps: MainApiDeps,
): MainApi<PluginManifest, ChannelShape, EventShape> {
  return {
    channel: deps.channels.forPlugin(manifest.id),
    events: pluginEvents(deps.bus, manifest.id),
    settings: deps.settings,
    services: deps.services,
    dependency: deps.dependency,
  };
}
