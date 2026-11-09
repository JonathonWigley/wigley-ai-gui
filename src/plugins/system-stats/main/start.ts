import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { SystemSample } from '../../../contracts/system-stats';
import { errorText } from '../../../shared/error-text';
import { chatSessionSlot } from '../../chat/contract';
import { sessionsRowsSlot } from '../../sessions/contract';
import {
  type StatsFixtureVariant,
  type SystemStatsChannel,
  systemStatsSnapshotSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { systemStatsManifest } from '../manifest';
import { addDriveActions } from './drive-actions';
import { sessionProcesses } from './grouping';
import { createStatsPoller, type StatsPoller } from './poller';
import {
  buildSnapshot,
  emptyHistory,
  errorSnapshot,
  historyCapacity,
  type StatsHistory,
} from './snapshot';
import { statsFixture } from './stats-fixture';

type SystemStatsApi = MainApi<typeof systemStatsManifest, SystemStatsChannel>;

// Registers the layouts and writes `system-stats.snapshot`: null at start and at each show, then a snapshot from
// each pair of good samples while the page reports the panel shown, the first sample of a show giving only the
// earlier reading. A rejected sample keeps the last snapshot with its error set, logged once per distinct text. A
// seed, from a drive run, writes a fixed snapshot and stops sampling for the run.
export const systemStatsMainPart: MainPart<typeof systemStatsManifest> = {
  manifest: systemStatsManifest,
  start(api: SystemStatsApi) {
    const { services } = api;
    api.layouts.register({ layoutTypes });
    const snapshot = api.state.publish(systemStatsSnapshotSlot);
    snapshot.set(null);
    const chatSessions = api.state.read(chatSessionSlot);
    const sessionRows = api.state.read(sessionsRowsSlot);
    const refreshSeconds = () => api.settings().refreshSeconds;
    let shown = false;
    // The last good sample of this show, with the clock's time when it was read.
    let prev: { sample: SystemSample; at: number } | null = null;
    let history: StatsHistory = emptyHistory(historyCapacity(refreshSeconds()));
    // The last rejection's text, until a good sample.
    let lastFailure: string | null = null;
    let seedStopLogged = false;

    const sampled = (sample: SystemSample, at: number) => {
      lastFailure = null;
      if (prev === null) {
        prev = { sample, at };
        const current = snapshot.get() ?? null;
        if (current !== null && current.error !== null) {
          snapshot.set({ ...current, error: null });
        }
        return;
      }
      const elapsedMs = at - prev.at;
      if (elapsedMs <= 0) {
        return;
      }
      const built = buildSnapshot(
        prev.sample,
        sample,
        elapsedMs,
        sessionProcesses(chatSessions.all().values(), sessionRows.all()),
        { ...history, capacity: historyCapacity(refreshSeconds()) },
        at,
      );
      prev = { sample, at };
      history = built.history;
      snapshot.set(built.snapshot);
    };
    const failed = (error: unknown) => {
      const text = errorText(error);
      if (text !== lastFailure) {
        services.log(`sample failed: ${text}`);
        lastFailure = text;
      }
      snapshot.set(
        errorSnapshot(snapshot.get() ?? null, services.clock.now(), text),
      );
    };
    let poller: StatsPoller | null = createStatsPoller({
      timers: services.timers,
      clock: services.clock,
      sample: () => services.systemStats.sample(),
      refreshSeconds,
      sampled,
      failed,
      log: services.log,
    });

    api.channel.handle('setShown', (next) => {
      if (poller === null) {
        if (!seedStopLogged) {
          services.log('sampling stopped by a seed');
          seedStopLogged = true;
        }
        return;
      }
      if (next === shown) {
        return;
      }
      shown = next;
      if (next) {
        snapshot.set(null);
        services.log('sampling started');
      } else {
        prev = null;
        services.log('sampling stopped');
      }
      poller.setShown(next);
    });
    api.onSettingsChanged(() => poller?.reschedule());

    const seed = (variant: StatsFixtureVariant) => {
      poller?.dispose();
      poller = null;
      const fixture = statsFixture(variant, services.clock.now());
      snapshot.set(fixture);
      api.channel.send('seeded', variant);
      services.log(`seeded ${variant}`);
      return fixture;
    };
    if (api.drive !== null) {
      addDriveActions(api.drive, {
        snapshot: () => snapshot.get() ?? null,
        seed,
      });
    }

    return { commands: {}, dispose: () => poller?.dispose() };
  },
};
