import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { SystemSample } from '../../../contracts/system-stats';
import { errorText } from '../../../shared/error-text';
import { chatSessionSlot } from '../../chat/contract';
import { sessionsRowsSlot } from '../../sessions/contract';
import {
  type StatsFixtureVariant,
  type StatsSnapshot,
  type SystemStatsChannel,
  systemStatsSnapshotSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { systemStatsManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { addDriveActions } from './drive-actions';
import { sessionProcesses } from './grouping';
import { createStatsPoller, type StatsPoller } from './poller';
import { systemStatsSelfTestScript } from './selftest-script';
import {
  buildSnapshot,
  emptyHistory,
  errorSnapshot,
  historyCapacity,
  type StatsHistory,
} from './snapshot';
import { statsFixture } from './stats-fixture';

type SystemStatsApi = MainApi<typeof systemStatsManifest, SystemStatsChannel>;

// Registers the layouts and writes `system-stats.snapshot`: null at start and at each show, then a snapshot from each
// pair of good samples while the page reports the panel shown, the first sample of a show giving only the earlier
// reading. Each show starts an empty history, so a sparkline never joins readings across a hide. A rejected sample
// keeps the last snapshot with its error set, logged once per distinct text. A seed, from a drive run or the
// self-test's script, writes a fixed snapshot and stops sampling for the run. Hands the self-test the panel script.
// While the demo step is entered, its busy fixture holds the slot and no reading reaches it; leaving draws real
// readings again from the next two samples, or puts a seed's snapshot back.
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
    // The demo step's snapshot while it is entered, and the slot's value when it entered.
    let demo: StatsSnapshot | null = null;
    let beforeDemo: StatsSnapshot | null = null;

    const sampled = (sample: SystemSample, at: number) => {
      if (demo !== null) {
        return;
      }
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
      if (demo !== null) {
        return;
      }
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
        history = emptyHistory(historyCapacity(refreshSeconds()));
        if (demo === null) {
          snapshot.set(null);
        }
        services.log('sampling started');
      } else {
        prev = null;
        services.log('sampling stopped');
      }
      poller.setShown(next);
    });
    api.onSettingsChanged(() => poller?.reschedule());

    registerDemoSteps(services, {
      setDemo(next) {
        if (next !== null) {
          if (demo === null) {
            beforeDemo = snapshot.get() ?? null;
          }
          demo = next;
          snapshot.set(next);
          return;
        }
        if (demo === null) {
          return;
        }
        demo = null;
        if (poller === null) {
          snapshot.set(beforeDemo);
        } else {
          prev = null;
          history = emptyHistory(historyCapacity(refreshSeconds()));
          snapshot.set(null);
        }
        beforeDemo = null;
      },
    });

    const seed = (variant: StatsFixtureVariant) => {
      poller?.dispose();
      poller = null;
      const fixture = statsFixture(variant, services.clock.now());
      snapshot.set(fixture);
      api.channel.send('seeded', variant);
      return fixture;
    };
    const current = () => snapshot.get() ?? null;
    if (api.drive !== null) {
      addDriveActions(api.drive, { snapshot: current, seed });
    }
    services.selfTest?.run(
      systemStatsSelfTestScript({ seed, snapshot: current }),
    );

    return { commands: {}, dispose: () => poller?.dispose() };
  },
};
