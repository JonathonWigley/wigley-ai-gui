import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { isFakeAgentHarness } from '../../../shared/fake-agent-harness';
import {
  chatEntriesSlot,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import { formsConfirmsSlot } from '../../forms/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { permissionReviewsSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { permissionReviewManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { watchReviewRequests } from './review-requests';
import { permissionReviewSelfTestScript } from './selftest-script';

type PermissionReviewApi = MainApi<
  typeof permissionReviewManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Registers permission-review's layouts, reviews each unanswered permission
// entry in `chat.entries` and each round in `forms.confirms` through its
// session's harness `ask` into `permission-review.reviews`, forgets a
// session's reviews on `sessions.ended`, registers the verdict demo step's
// main half, and hands the self-test its script.
export const permissionReviewMainPart: MainPart<
  typeof permissionReviewManifest
> = {
  manifest: permissionReviewManifest,
  start(api: PermissionReviewApi) {
    api.layouts.register({ layoutTypes });
    const reviews = api.state.publish(permissionReviewsSlot);
    const chatSessions = api.state.read(chatSessionSlot);
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const { services } = api;
    const watcher = watchReviewRequests({
      chatSessions,
      chatEntries: api.state.read(chatEntriesSlot),
      confirms: api.state.read(formsConfirmsSlot),
      harnessInfos: api.state.read(coreAgentHarnessesSlot),
      harnesses: services.agentHarnesses,
      defaultProfile: (sessionId) => chat.defaultProfile(sessionId),
      reviews,
      label: (sessionId) => sessions.label(sessionId),
      timers: services.timers,
      log: services.log,
    });
    api.events.on('sessions.ended', ({ sessionId }) =>
      watcher.forgetSession(sessionId),
    );
    registerDemoSteps(services);
    services.selfTest?.run(
      permissionReviewSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat,
        sessions,
        fakeOf(sessionId) {
          const harnessId = chatSessions.get(sessionId)?.harness;
          const harness =
            harnessId === undefined
              ? null
              : services.agentHarnesses.get(harnessId);
          return harness !== null && isFakeAgentHarness(harness)
            ? harness
            : null;
        },
      }),
    );
    return { commands: {}, dispose: () => watcher.dispose() };
  },
};
