import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
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
import { createHarnessFolders } from '../../../shared/harness-folders';
import { locateWigleyFile } from '../../../shared/wigley-install';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatMainEvents,
  chatEntriesSlot,
  chatMainKey,
} from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { livePicksSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { liveViewManifest } from '../manifest';
import { pickOf, rectOfTuple } from '../window-pick';
import { registerDemoSteps } from './demo-steps';
import { CAPTURE_SCRIPT_IN_INSTALL, probeGameRect } from './game-view-probe';
import { createLiveTools, LIVE_VIEW_OFFLINE } from './live-tools';
import { createPlaytestWatch } from './playtest-watch';
import { liveViewSelfTestScript } from './selftest-script';

type LiveViewApi = MainApi<
  typeof liveViewManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Registers live-view's layouts; contributes `show_live_view` and
// `hide_live_view` to every session, subagents included, which write the
// session's pick to `live-view.picks`; runs the playtest watch, which opens and
// closes a session's pick on its live playtest Bash calls, read from chat's
// entries and agent events, cropping an opened pick to the Game View that
// WigleyCapture.cs's probe, from the wigley plugin install, finds; deletes the
// pick on `sessions.ended`; writes chat's layout preview row a sample pick,
// the real pick and crop over the fake ScreenCapture's windows; registers the Live view demo step's main
// half, which picks the Unity editor or the app's own window; and hands the
// self-test its script.
export const liveViewMainPart: MainPart<typeof liveViewManifest> = {
  manifest: liveViewManifest,
  start(api: LiveViewApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const picks = api.state.publish(livePicksSlot);
    const harnessInfos = api.state.read(coreAgentHarnessesSlot);
    const folders = createHarnessFolders({
      harnesses: services.agentHarnesses,
      infos: () => harnessInfos.all(),
      log: services.log,
    });
    const probeDeps = {
      processes: services.processes,
      files: services.files,
      paths: services.paths,
      locateScript: () =>
        locateWigleyFile(
          services.files,
          folders,
          services.paths,
          CAPTURE_SCRIPT_IN_INSTALL,
        ),
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
