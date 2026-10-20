import type {
  ChannelShape,
  MainApi,
  MainServices,
  PluginManifest,
  SelfTestHost,
  UntypedEvents,
} from '../../contracts/plugin';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { scopedFiles } from '../../shared/scoped-files';
import type { PluginChannels } from './plugin-channel';

// `settings` is the plugin's merged settings; `services` is shared by every
// main part, and `selfTestFor` gives each plugin its own self-test host, null
// outside the self-test; `dependency` is the host's; `bus` is shared by every
// main part; `dataRoot` is the absolute folder that holds a folder per plugin,
// named by its id.
export interface MainApiDeps {
  channels: PluginChannels;
  settings: object;
  services: Omit<MainServices, 'selfTest'>;
  selfTestFor(pluginId: string): SelfTestHost | null;
  dependency<E>(pluginId: string): E;
  bus: EventBus;
  dataRoot: string;
}

export function createMainApi(
  manifest: PluginManifest,
  deps: MainApiDeps,
): MainApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  return {
    channel: deps.channels.forPlugin(manifest.id),
    events: pluginEvents(deps.bus, manifest.id),
    settings: deps.settings,
    services: { ...deps.services, selfTest: deps.selfTestFor(manifest.id) },
    dependency: deps.dependency,
    data: scopedFiles(deps.services.files, `${deps.dataRoot}/${manifest.id}`),
  };
}
