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
import { createLiveTools, LIVE_VIEW_OFFLINE } from './live-tools';
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
// session's pick to `live-view.picks`; deletes it on `sessions.ended`; writes
// chat's layout preview row a sample pick, the real pick and crop over the
// fake ScreenCapture's windows; and hands the self-test its script.
export const liveViewMainPart: MainPart<typeof liveViewManifest> = {
  manifest: liveViewManifest,
  start(api: LiveViewApi) {
    api.layouts.register({ layoutTypes });
    const { services } = api;
    const picks = api.state.publish(livePicksSlot);
    const liveTools = createLiveTools({
      files: services.files,
      paths: services.paths,
      screenCapture: services.screenCapture,
      picks,
      log: services.log,
    });
    const sessions = api.dependency(sessionsMainKey);
    sessions.contributeTools(
      [...liveTools.definitions],
      liveTools.startSession,
      { offline: LIVE_VIEW_OFFLINE },
    );
    api.events.on('sessions.ended', ({ sessionId }) =>
      liveTools.sessionEnded(sessionId),
    );

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
    api.events.on('chat.agentEvent', ({ sessionId, hostSessionId }) => {
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
    };
  },
};
