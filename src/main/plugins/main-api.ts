import type { Disposable, Registrations } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  ChannelShape,
  ConfigProblemsService,
  DependencyKey,
  DriveHost,
  MainApi,
  MainCommandContext,
  MainServices,
  PluginManifest,
  PluginSwitchService,
  SelfTestHost,
  UntypedEvents,
} from '../../contracts/plugin';
import type { ConfigProblem } from '../../contracts/settings';
import { pluginDemoSteps } from '../../shared/demo-step-registry';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { pluginLog } from '../../shared/plugin-log';
import {
  abortableProcesses,
  trackedAgentHarnesses,
  trackedAlerts,
  trackedFiles,
  trackedUserConfig,
} from '../../shared/plugin-service-views';
import { scopedFiles } from '../../shared/scoped-files';
import type { RuntimeCommands } from '../../shared/runtime-commands';
import { mainPluginState, type SlotStore } from '../../shared/state/slot-store';
import { trackedTimers } from '../../shared/tracked-timers';
import type { LayoutService } from '../layouts/layout-service';
import type { PluginChannels } from './plugin-channel';

// Every main part's config problems, held by plugin id: `set` replaces the
// plugin's entry and `delete` drops it.
export interface PluginConfigProblems {
  set(pluginId: string, problems: readonly ConfigProblem[]): void;
  delete(pluginId: string): void;
}

// The services the main core hands the plugin APIs: each plugin's `selfTest`,
// scoped `log` and `configProblems` view are made from these, `log` being the
// core's own.
export type MainApiServices = Omit<
  MainServices,
  'selfTest' | 'log' | 'configProblems'
> & {
  log: Log;
  configProblems: PluginConfigProblems;
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
// reaches under its id; `state` is the store of main's slot holder; `commands`
// is main's commands, which each plugin reaches under its id.
export interface MainApiDeps {
  channels: Pick<PluginChannels, 'forPlugin'>;
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
  state: SlotStore;
  commands: RuntimeCommands<MainCommandContext<any>>;
}

// One plugin's main API. `services.log` is scoped to its id. Every registration
// it makes through the API is filed in `deps.registrations`. Timers, file watches
// (`data`'s included), running processes and alert counts are held per plugin
// and filed as one entry each, so a run timer or a disposed watch leaves nothing
// in the store; `services.git` is not recorded, since it makes only short runs.
// Its demo steps, the holds `pluginSwitch.runDisabledForNow` gives it, and the
// clearing of its `configProblems` entry are filed there too.
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
  const dataFolder = deps.services.paths.join(deps.dataRoot, manifest.id);
  const pluginCommands = deps.commands.forPlugin(manifest.id, (handle) =>
    registrations.track(handle),
  );
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
      agentHarnesses: trackedAgentHarnesses(
        deps.services.agentHarnesses,
        registrations,
      ),
      demoSteps: pluginDemoSteps(
        deps.services.demoSteps,
        manifest.id,
        registrations,
      ),
      pluginSwitch: trackedPluginSwitch(
        deps.services.pluginSwitch,
        registrations,
      ),
      timers: trackedTimers(deps.services.timers, registrations),
      userConfig: trackedUserConfig(deps.services.userConfig, registrations),
      configProblems: trackedConfigProblems(
        deps.services.configProblems,
        manifest.id,
        registrations,
      ),
      selfTest: deps.selfTestFor(manifest.id),
    },
    dependency: <E>(key: DependencyKey<E, 'main'>) =>
      deps.dependency(key.id) as E,
    data: scopedFiles(files, dataFolder, deps.services.paths),
    dataFolder,
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
    state: mainPluginState(deps.state, manifest, (handle) =>
      registrations.track(handle),
    ),
    commands: pluginCommands.commands,
    keys: { bind: pluginCommands.bind },
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

// One plugin's view of `configProblems`: `set` replaces the plugin's entry,
// and `registrations` disposing it, after the first `set`, deletes the entry;
// a `set` after that dispose is deleted at once.
function trackedConfigProblems(
  configProblems: PluginConfigProblems,
  pluginId: string,
  registrations: Registrations,
): ConfigProblemsService {
  let isTracked = false;
  return {
    set(problems) {
      configProblems.set(pluginId, problems);
      if (!isTracked) {
        isTracked = true;
        registrations.track({
          dispose() {
            isTracked = false;
            configProblems.delete(pluginId);
          },
        });
      }
    },
  };
}

// One plugin's view of `pluginSwitch`: `registrations` disposing it disposes
// every hold `runDisabledForNow` gave the plugin, and a hold that resolves after
// that is disposed at once.
function trackedPluginSwitch(
  pluginSwitch: PluginSwitchService,
  registrations: Registrations,
): PluginSwitchService {
  return {
    mayDisable: (pluginId) => pluginSwitch.mayDisable(pluginId),
    runDisabledForNow: async () =>
      registrations.track(await pluginSwitch.runDisabledForNow()),
  };
}
