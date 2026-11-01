import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  CHAT_HARNESS_ID,
  type ChatMainEvents,
  type ChatMainExports,
} from '../../chat/contract';
import type { SessionsMainEvents } from '../../sessions/contract';
import type { UsageChannel } from '../contract';
import { usageManifest } from '../manifest';
import { createPlanPoller } from './plan-poller';
import {
  EMPTY_USAGE_STATE,
  type UsageState,
  withLiveRows,
  withoutSession,
  withPollResult,
  withProfiles,
  withSessionUsage,
} from './usage-store';

type UsageApi = MainApi<
  typeof usageManifest,
  UsageChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Serves the page the usage snapshot and sends it on every change. Seeds a
// plan per chat profile, polls each through the Claude harness every
// `pollIntervalSeconds` (rescheduled on a settings change), and hears
// `chat.planUsage` (live rows), `chat.sessionOpened` (a session's profile),
// `chat.agentEvent` (the main agent's `usage`) and `sessions.ended`.
export const usageMainPart: MainPart<typeof usageManifest> = {
  manifest: usageManifest,
  start(api: UsageApi) {
    const { services, channel, events } = api;
    const chat = api.dependency<ChatMainExports>('chat');
    let state = EMPTY_USAGE_STATE;
    const apply = (next: UsageState) => {
      const changed = next.snapshot !== state.snapshot;
      state = next;
      if (changed) {
        channel.send('changed', state.snapshot);
      }
    };
    channel.handle('snapshot', () => state.snapshot);
    apply(withProfiles(state, chat.profiles()));
    events.on('chat.planUsage', ({ profileDir, update }) =>
      apply(withLiveRows(state, profileDir, update)),
    );
    events.on('chat.sessionOpened', ({ sessionId, profileDir }) =>
      apply(withSessionUsage(state, sessionId, profileDir, null)),
    );
    events.on('chat.agentEvent', ({ sessionId, profileDir, event }) => {
      if (event.type === 'usage' && event.agentId === 'main') {
        apply(withSessionUsage(state, sessionId, profileDir, event));
      }
    });
    events.on('sessions.ended', ({ sessionId }) =>
      apply(withoutSession(state, sessionId)),
    );
    const harness = services.agentHarnesses.find(
      (candidate) => candidate.id === CHAT_HARNESS_ID,
    );
    if (harness === undefined) {
      services.log(
        'usage',
        `no agent harness "${CHAT_HARNESS_ID}": plan usage is not read`,
      );
      return { commands: {} };
    }
    const poller = createPlanPoller({
      timers: services.timers,
      clock: services.clock,
      profiles: () => chat.profiles(),
      intervalSeconds: () => api.settings().pollIntervalSeconds,
      planUsage: (profileDir) => harness.planUsage(profileDir),
      roundStarted: (profiles) => apply(withProfiles(state, profiles)),
      polled: (profile, result) => {
        if (!result.ok) {
          services.log('usage', `poll ${profile.name} failed: ${result.error}`);
        }
        apply(withPollResult(state, profile.configDir, result));
      },
    });
    const settingsListener = api.onSettingsChanged(() => poller.reschedule());
    poller.start();
    return {
      commands: {},
      dispose() {
        settingsListener.dispose();
        poller.dispose();
      },
    };
  },
};
