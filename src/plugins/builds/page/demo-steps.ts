import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { ChatPageExports } from '../../chat/contract';
import type { SessionsPageExports } from '../../sessions/contract';
import {
  type BuildsDemoSample,
  DEMO_FIRST_GAME,
  demoSample,
  demoSessionSample,
} from './demo-sample';

// `showSample` draws a sample in place of the slots in Builds mode and the session parts, null dropping it;
// `selectEntry` shows a side-bar entry; `activate` and `showHubForNow` are sessions' and chat's.
export interface BuildsDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  showSample(sample: BuildsDemoSample | null): void;
  selectEntry(key: string): void;
  activate: SessionsPageExports['activate'];
  showHubForNow: ChatPageExports['showHubForNow'];
}

// The Builds step: Builds mode on the sample's first game. The Session builds step: the demo session main launched,
// shown with its row line, its hub's Builds section held open, and its offer card. Each sample lives in the page until
// the stage's dispose.
export function registerDemoSteps(
  services: PageServices,
  deps: BuildsDemoPageDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'builds.mode',
      section: 'modes',
      order: 70,
      title: 'Builds',
      caption:
        'Builds: the CI and local builds of tracked games, queued in one press and followed live.',
      files: [
        'src/plugins/builds/page/builds-view.ts',
        'src/plugins/builds/page/start.ts',
        'src/plugins/builds/main/start.ts',
        'src/plugins/builds/layouts/default/layout.js',
      ],
      enter: async () => buildsStage(deps, services.clock.now()),
    }),
  );
  registrations.track(
    services.demoSteps.register({
      id: 'builds.session',
      section: 'sessions',
      order: 190,
      title: 'Session builds',
      caption:
        'A session shows the builds it queued on its row and in its hub, and offers a build above its composer.',
      files: [
        'src/plugins/builds/page/session-parts.ts',
        'src/plugins/builds/page/start.ts',
        'src/plugins/builds/main/start.ts',
        'src/plugins/builds/layouts/default/layout.js',
      ],
      async enter(context) {
        const rowId = context.sessions.build;
        if (rowId === undefined) {
          throw new Error('builds.session: no demo session');
        }
        return sessionStage(deps, services.clock.now(), rowId);
      },
    }),
  );
  return registrations;
}

function buildsStage(deps: BuildsDemoPageDeps, now: number): DemoStage {
  const { commands } = deps;
  deps.showSample({ snapshot: demoSample(now), sessions: new Map() });
  return {
    beats: [
      {
        name: 'game',
        async show() {
          await commands.run(MODES_SHOW, 'builds.main');
          deps.selectEntry(DEMO_FIRST_GAME);
        },
      },
    ],
    dispose: () => deps.showSample(null),
  };
}

function sessionStage(
  deps: BuildsDemoPageDeps,
  now: number,
  rowId: string,
): DemoStage {
  deps.showSample(demoSessionSample(now, rowId));
  const hub = deps.showHubForNow('builds.hub');
  return {
    beats: [{ name: 'session', show: () => deps.activate(rowId) }],
    dispose() {
      try {
        deps.showSample(null);
      } finally {
        hub.dispose();
      }
    },
  };
}
