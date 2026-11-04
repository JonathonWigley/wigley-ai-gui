import type { Disposable, Registrations } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  ChannelShape,
  DependencyKey,
  DriveHost,
  MainApi,
  MainServices,
  PluginManifest,
  SelfTestHost,
  UntypedEvents,
} from '../../contracts/plugin';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { pluginLog } from '../../shared/plugin-log';
import {
  abortableProcesses,
  trackedAlerts,
  trackedFiles,
  trackedUserConfig,
} from '../../shared/plugin-service-views';
import { scopedFiles } from '../../shared/scoped-files';
import { trackedTimers } from '../../shared/tracked-timers';
import type { LayoutService } from '../layouts/layout-service';
import type { PluginChannels } from './plugin-channel';

// The services the main core hands the plugin APIs: each plugin's `selfTest`
// and scoped `log` are made from these, `log` being the core's own.
export type MainApiServices = Omit<MainServices, 'selfTest' | 'log'> & {
  log: Log;
};

// `pluginSettings` reads every plugin's settings, by plugin id, as the user
// config now sets them, and `onPluginSettingsChanged` hears them each time the
// config changes; `services` is shared by every main part, run mode included,
// and `selfTestFor` gives each plugin its own self-test host, null outside the
// self-test; `driveFor` gives each plugin its own drive host, null outside a
// drive run; `dependency` is the host's; `registrations` is the part's own
// store, which the host disposes when the part stops; `bus` is shared by every
// main part; `dataRoot` is the absolute folder that holds a folder per plugin,
// named by its id; `layouts` is the core layouts service, which each plugin
// reaches under its id.
export interface MainApiDeps {
  channels: PluginChannels;
  pluginSettings(): Record<string, object>;
  onPluginSettingsChanged(
    listener: (settingsByPlugin: Record<string, object>) => void,
  ): Disposable;
  services: MainApiServices;
  selfTestFor(pluginId: string): SelfTestHost | null;
  driveFor(pluginId: string): DriveHost | null;
  dependency(pluginId: string): unknown;
  registrations: Registrations;
  bus: EventBus;
  dataRoot: string;
  layouts: LayoutService;
}

// One plugin's main API. `services.log` is scoped to its id. Every registration
// it makes through the API is filed in `deps.registrations`. Timers, file watches
// (`data`'s included), running processes and alert counts are held per plugin
// and filed as one entry each, so a run timer or a disposed watch leaves nothing
// in the store; `services.git` is not recorded, since it makes only short runs.
// `onSettingsChanged` calls its listener only when the JSON of this plugin's
// settings differs from the last it saw, so another plugin's change calls
// nothing.
export function createMainApi(
  manifest: PluginManifest,
  deps: MainApiDeps,
): MainApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  const { registrations } = deps;
  const channel = deps.channels.forPlugin(manifest.id);
  const events = pluginEvents(deps.bus, manifest.id, deps.services.log);
  const files = trackedFiles(deps.services.files, registrations);
  return {
    channel: {
      handle: (method, handler) =>
        registrations.track(channel.handle(method, handler)),
      send: channel.send,
    },
    events: {
      emit: events.emit,
      on: (qualifiedEvent, listener) =>
        registrations.track(events.on(qualifiedEvent, listener)),
    },
    settings: () => deps.pluginSettings()[manifest.id],
    onSettingsChanged: (listener) => {
      let lastSeen = JSON.stringify(deps.pluginSettings()[manifest.id]);
      return registrations.track(
        deps.onPluginSettingsChanged((settingsByPlugin) => {
          const settings = settingsByPlugin[manifest.id];
          const seen = JSON.stringify(settings);
          if (seen !== lastSeen) {
            lastSeen = seen;
            listener(settings);
          }
        }),
      );
    },
    services: {
      ...deps.services,
      log: pluginLog(deps.services.log, manifest.id),
      files,
      processes: abortableProcesses(deps.services.processes, registrations),
      alerts: trackedAlerts(deps.services.alerts, registrations),
      timers: trackedTimers(deps.services.timers, registrations),
      userConfig: trackedUserConfig(deps.services.userConfig, registrations),
      selfTest: deps.selfTestFor(manifest.id),
    },
    dependency: <E>(key: DependencyKey<E, 'main'>) =>
      deps.dependency(key.id) as E,
    data: scopedFiles(
      files,
      deps.services.paths.join(deps.dataRoot, manifest.id),
      deps.services.paths,
    ),
    drive: trackedDrive(deps.driveFor(manifest.id), registrations),
    layouts: {
      register: (options) =>
        registrations.track(
          deps.layouts.register(
            manifest.id,
            options.layoutTypes,
            `src/plugins/${manifest.id}/layouts/default`,
          ),
        ),
      names: () => deps.layouts.names(manifest.id),
    },
  };
}

function trackedDrive(
  drive: DriveHost | null,
  registrations: Registrations,
): DriveHost | null {
  if (drive === null) {
    return null;
  }
  return {
    add: (name, action) => registrations.track(drive.add(name, action)),
  };
}
