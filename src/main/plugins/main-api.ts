import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DriveHost,
  MainApi,
  MainServices,
  PluginManifest,
  SelfTestHost,
  UntypedEvents,
} from '../../contracts/plugin';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { scopedFiles } from '../../shared/scoped-files';
import type { LayoutService } from '../layouts/layout-service';
import type { PluginChannels } from './plugin-channel';

// `pluginSettings` reads every plugin's settings, by plugin id, as the user
// config now sets them, and `onPluginSettingsChanged` hears them each time the
// config changes; `services` is shared by every main part, run mode included,
// and `selfTestFor` gives each plugin its own self-test host, null outside the
// self-test; `driveFor` gives each plugin its own drive host, null outside a
// drive run; `dependency` is the host's; `bus` is shared by every main part;
// `dataRoot` is the absolute folder that holds a folder per plugin, named by
// its id; `layouts` is the core layouts service, which each plugin reaches
// under its id.
export interface MainApiDeps {
  channels: PluginChannels;
  pluginSettings(): Record<string, object>;
  onPluginSettingsChanged(
    listener: (settingsByPlugin: Record<string, object>) => void,
  ): Disposable;
  services: Omit<MainServices, 'selfTest'>;
  selfTestFor(pluginId: string): SelfTestHost | null;
  driveFor(pluginId: string): DriveHost | null;
  dependency<E>(pluginId: string): E;
  bus: EventBus;
  dataRoot: string;
  layouts: LayoutService;
}

// `onSettingsChanged` calls its listener only when the JSON of this plugin's
// settings differs from the last it saw, so another plugin's change calls
// nothing.
export function createMainApi(
  manifest: PluginManifest,
  deps: MainApiDeps,
): MainApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  return {
    channel: deps.channels.forPlugin(manifest.id),
    events: pluginEvents(deps.bus, manifest.id, deps.services.log),
    settings: () => deps.pluginSettings()[manifest.id],
    onSettingsChanged: (listener) => {
      let lastSeen = JSON.stringify(deps.pluginSettings()[manifest.id]);
      return deps.onPluginSettingsChanged((settingsByPlugin) => {
        const settings = settingsByPlugin[manifest.id];
        const seen = JSON.stringify(settings);
        if (seen !== lastSeen) {
          lastSeen = seen;
          listener(settings);
        }
      });
    },
    services: { ...deps.services, selfTest: deps.selfTestFor(manifest.id) },
    dependency: deps.dependency,
    data: scopedFiles(
      deps.services.files,
      deps.services.paths.join(deps.dataRoot, manifest.id),
      deps.services.paths,
    ),
    drive: deps.driveFor(manifest.id),
    layouts: {
      register: (options) =>
        deps.layouts.register(manifest.id, options.layoutTypes),
      names: () => deps.layouts.names(manifest.id),
    },
  };
}
