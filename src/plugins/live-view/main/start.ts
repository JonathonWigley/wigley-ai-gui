import type { LiveViewContribution } from '../../../contracts/contributions';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createFakeScreenCapture,
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from '../../../shared/fake-screen-capture';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatMainEvents,
  chatEntriesSlot,
  chatMainKey,
} from '../../chat/contract';
import { contributionsMainKey } from '../../contributions/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { livePicksSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { liveViewManifest } from '../manifest';
import type { PlaytestPatterns } from '../playtest-command';
import { pickOf, rectOfTuple } from '../window-pick';
import { registerDemoSteps } from './demo-steps';
import { type ProbeScript, probeGameRect } from './game-view-probe';
import { createLiveTools, LIVE_VIEW_OFFLINE } from './live-tools';
import {
  liveViewReader,
  playtestPatternsOf,
  probeScriptOf,
} from './live-view-reader';
import { createPlaytestWatch } from './playtest-watch';
import { liveViewSelfTestScript } from './selftest-script';

type LiveViewApi = MainApi<
  typeof liveViewManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Registers live-view's layouts and its `liveView` reader with
// `contributions`; contributes `show_live_view` and `hide_live_view` to every
// session, subagents included, which write the session's pick to
// `live-view.picks`; runs the playtest watch, which opens a session's pick when
// a live Bash call matches an installed plugin's open pattern, cropped to the
// Game View that plugin's probe reports, and closes it on a close pattern,
// read from chat's entries and agent events; deletes the pick on
// `sessions.ended`; writes chat's layout preview row a sample pick,
// the real pick and crop over the fake ScreenCapture's windows; registers the
// Live view demo step's main half, which picks the Unity editor or the app's
// own window; and hands the self-test its script.
export const liveViewMainPart: MainPart<typeof liveViewManifest> = {
  manifest: liveViewManifest,
  start(api: LiveViewApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const picks = api.state.publish(livePicksSlot);
    // Empty until the first scan settles, then every strategy's, merged.
    let patterns: PlaytestPatterns = { open: [], close: [] };
    let probe: ProbeScript | null = null;
    let isMissingProbeLogged = false;
    const contributions = api.dependency(contributionsMainKey);
    const applyStrategies = () => {
      const strategies =
        contributions.strategies<LiveViewContribution>('liveView');
      patterns = playtestPatternsOf(strategies);
      probe = probeScriptOf(strategies, services.paths);
      isMissingProbeLogged = false;
    };
    contributions.registerFeature('liveView', liveViewReader);
    contributions.onChanged('liveView', applyStrategies);
    void contributions.ready.then(applyStrategies);
    // The probe whose file exists; a missing file is logged once per change
    // of the strategies.
    const locateScript = async (): Promise<ProbeScript | null> => {
      const script = probe;
      if (script === null) {
        return null;
      }
      try {
        await services.files.realPath(script.file);
        return script;
      } catch {
        if (!isMissingProbeLogged) {
          isMissingProbeLogged = true;
          services.log(
            `live view: ${script.pluginName}'s probe file ${script.file} is missing`,
          );
        }
        return null;
      }
    };
    const probeDeps = {
      processes: services.processes,
      files: services.files,
      paths: services.paths,
      locateScript,
      wait: (ms: number) =>
        new Promise<void>((resolve) => {
          services.timers.set(resolve, ms);
        }),
    };
    const liveTools = createLiveTools({
      files: services.files,
      paths: services.paths,
      screenCapture: services.screenCapture,
      picks,
      log: services.log,
      probeGameRect: (projectPath, isCancelled) =>
        probeGameRect(probeDeps, projectPath, isCancelled),
    });
    const sessions = api.dependency(sessionsMainKey);
    sessions.contributeTools(
      [...liveTools.definitions],
      liveTools.startSession,
      { offline: LIVE_VIEW_OFFLINE },
    );
    const watch = createPlaytestWatch({
      entries: api.state.read(chatEntriesSlot),
      liveTools,
      log: services.log,
      patterns: () => patterns,
    });
    api.events.on('sessions.ended', ({ sessionId }) => {
      liveTools.sessionEnded(sessionId);
      watch.sessionEnded(sessionId);
    });
    // A stage entered or left after this part stopped writes no pick.
    let isStopped = false;
    registerDemoSteps(services, {
      screenCapture: services.screenCapture,
      picks: {
        set: (sessionId, pick) => {
          if (!isStopped) {
            picks.set(sessionId, pick);
          }
        },
        delete: (sessionId) => {
          if (!isStopped) {
            picks.delete(sessionId);
          }
        },
      },
      ownProcessId: process.pid,
      log: services.log,
    });

    // The preview emits several events in a row, so the key is checked again
    // after the await.
    const writeSamplePick = async (sessionId: string) => {
      const result = pickOf(
        await createFakeScreenCapture().listWindows(),
        FAKE_EDITOR_PROCESS_ID,
        rectOfTuple(FAKE_GAME_RECT),
        'sample',
      );
      if ('error' in result) {
        services.log(`preview sample not picked: ${result.error}`);
        return;
      }
      if (picks.get(sessionId) === undefined) {
        picks.set(sessionId, result.pick);
      }
    };
    api.events.on('chat.agentEvent', (agentEvent) => {
      watch.agentEvent(agentEvent);
      const { sessionId, hostSessionId } = agentEvent;
      const isPreviewWithoutPick =
        hostSessionId === CHAT_PREVIEW_HOST_ID &&
        picks.get(sessionId) === undefined;
      if (isPreviewWithoutPick) {
        void writeSamplePick(sessionId);
      }
    });

    services.selfTest?.run(
      liveViewSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat: api.dependency(chatMainKey),
        sessions,
        show: liveTools.show,
        picks: api.state.read(livePicksSlot),
      }),
    );

    return {
      commands: {
        openScreenSettings: () => {
          services.screenCapture
            .openAccessSettings()
            .catch((error: unknown) =>
              services.log(
                `Screen Recording settings not opened: ${errorText(error)}`,
              ),
            );
        },
      },
      dispose: () => {
        isStopped = true;
      },
    };
  },
};
