import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import type { SessionStashChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { sessionStashManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { sessionStashSelfTestScript } from './selftest-script';
import { createSessionStash } from './session-stash';
import { createStashStore } from './stash-store';

type SessionStashApi = MainApi<
  typeof sessionStashManifest,
  SessionStashChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// Keeps each stash the page asks for, of a session chat owns, until its
// session's close, the page's drop or the page starting again, writes it to
// `stashed.json` in the plugin data, and gives chat the Stashed section over
// that file, or sample rows while the demo runs. It starts before session-log,
// so Stashed sits above Recently closed. Registers the layouts and the demo
// step's main half, and hands the self-test its script.
export const sessionStashMainPart: MainPart<typeof sessionStashManifest> = {
  manifest: sessionStashManifest,
  start(api: SessionStashApi) {
    const { services } = api;
    api.layouts.register({ layoutTypes });
    const chat = api.dependency(chatMainKey);
    const store = createStashStore(api.data);
    const stash = createSessionStash({
      store,
      log: services.log,
      now: () => services.clock.now(),
      ownsSession: (sessionId) => chat.profileOf(sessionId) !== null,
      isDemoRunning: () =>
        services.agentHarnesses.get(DEMO_HARNESS_ID) !== null,
      sampleProjectDir: services.paths.join(
        services.homeDir,
        'dev',
        'sample-app',
      ),
    });
    registerDemoSteps(services);

    api.channel.handle('stash', (request) => stash.request(request));
    api.channel.handle('drop', (sessionId) => stash.drop(sessionId));
    api.channel.handle('forgetKept', () => stash.forgetKept());
    api.events.on('chat.sessionClosed', (closed) => stash.closed(closed));
    api.events.on('chat.sessionOpened', (opened) => stash.opened(opened));

    chat.addResumeSection({
      title: 'Stashed',
      rows: (isResumable) => stash.rows(isResumable),
    });

    services.selfTest?.run(
      sessionStashSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat,
        sessions: api.dependency(sessionsMainKey),
      }),
    );

    return { commands: {}, dispose: () => store.settled() };
  },
};
