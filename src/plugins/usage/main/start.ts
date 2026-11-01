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
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { UsageChannel, UsageSnapshot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { usageManifest } from '../manifest';
import { addDriveActions } from './drive-actions';
import { createPlanPoller, type PlanPoller } from './plan-poller';
import { usageSelfTestScript } from './selftest-script';
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

// Registers usage's layouts. Serves the page the usage snapshot and sends it on every change. Seeds a
// plan per chat profile, polls each through the Claude harness every
// `pollIntervalSeconds` (rescheduled on a settings change), and hears
// `chat.planUsage` (live rows), `chat.sessionOpened` (a session's profile),
// `chat.agentEvent` (the main agent's `usage`) and `sessions.ended`. It hands
// the self-test its script, and in a drive run it adds the drive actions; a
// seed from either replaces the snapshot and stops the poller for the run,
// while live rows and usage events still fold.
export const usageMainPart: MainPart<typeof usageManifest> = {
  manifest: usageManifest,
  start(api: UsageApi) {
    const { services, channel, events } = api;
    const layouts = api.layouts.register({ layoutTypes });
    const chat = api.dependency<ChatMainExports>('chat');
    const sessions = api.dependency<SessionsMainExports>('sessions');
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
    const noHarness = `no agent harness "${CHAT_HARNESS_ID}"`;
    if (harness === undefined) {
      services.log('usage', `${noHarness}: plan usage is not read`);
    }
    let poller: PlanPoller | null =
      harness === undefined
        ? null
        : createPlanPoller({
            timers: services.timers,
            clock: services.clock,
            profiles: () => chat.profiles(),
            intervalSeconds: () => api.settings().pollIntervalSeconds,
            planUsage: (profileDir) => harness.planUsage(profileDir),
            roundStarted: (profiles) => apply(withProfiles(state, profiles)),
            polled: (profile, result) => {
              if (!result.ok) {
                services.log(
                  'usage',
                  `poll ${profile.name} failed: ${result.error}`,
                );
              }
              apply(withPollResult(state, profile.configDir, result));
            },
          });
    let seeded = false;
    const seed = (snapshot: UsageSnapshot) => {
      seeded = true;
      poller?.dispose();
      poller = null;
      apply({ snapshot, held: [] });
    };
    const pollNow = () => {
      if (poller === null) {
        const reason = seeded
          ? 'usage.seed stopped the poller for this run'
          : noHarness;
        return Promise.reject(new Error(reason));
      }
      return poller.pollNow();
    };
    const settingsListener = api.onSettingsChanged(() => poller?.reschedule());
    poller?.start();
    const snapshot = () => state.snapshot;
    services.selfTest?.run(
      usageSelfTestScript({ sessions, clock: services.clock, snapshot, seed }),
    );
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, {
            clock: services.clock,
            selectedSessionId: () => sessions.selectedSessionId(),
            snapshot,
            seed,
            pollNow,
            harnesses: services.agentHarnesses,
          })
        : null;
    return {
      commands: {},
      dispose() {
        layouts.dispose();
        settingsListener.dispose();
        poller?.dispose();
        driveActions?.dispose();
      },
    };
  },
};
