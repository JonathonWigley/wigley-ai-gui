import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { Paths } from '../../../contracts/paths';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import {
  sessionsSelectRowCommand,
  sessionsSelectTabCommand,
} from '../../sessions/contract';
import { SAMPLE_HOME_FOLDER, SAMPLE_SOURCE_ID } from '../contract';

// A sample view Docs mode shows in place of the machine view until `dispose`;
// `openDoc` opens `path` in it at the 1-based `line`.
export interface DocsSampleView extends Disposable {
  openDoc(path: string, line: number | null): void;
}

export interface DocsDemoPageDeps {
  showSample(sourceId: string): DocsSampleView;
  commands: Pick<PluginCommands, 'run'>;
  paths: Pick<Paths, 'join'>;
}

// The Docs steps: Docs mode over the sample docs main holds, then a demo
// session's Docs tab over the same sample.
export function registerDemoSteps(
  services: PageServices,
  deps: DocsDemoPageDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'docs.mode',
      section: 'modes',
      order: 10,
      title: 'Docs',
      caption:
        'Docs: every agent doc on the machine, browsed as a tree of rendered pages.',
      files: [
        'src/plugins/docs/page/docs-view.ts',
        'src/plugins/docs/page/start.ts',
        'src/plugins/docs/main/start.ts',
      ],
      enter: async (context) => docsModeStage(deps, context),
    }),
  );
  registrations.track(
    services.demoSteps.register({
      id: 'docs.sessionTab',
      section: 'modes',
      order: 20,
      title: 'Docs tab',
      caption: 'The Docs tab: the docs one session reads, beside its chat.',
      files: [
        'src/plugins/docs-session-tab/page/start.ts',
        'src/plugins/docs/page/start.ts',
        'src/plugins/docs/main/start.ts',
      ],
      enter: async (context) => sessionTabStage(deps, context),
    }),
  );
  return registrations;
}

function docsModeStage(
  deps: DocsDemoPageDeps,
  context: DemoPageContext,
): DemoStage {
  const { paths, commands } = deps;
  const home = paths.join(context.scratchDir, SAMPLE_HOME_FOLDER);
  const sample = deps.showSample(SAMPLE_SOURCE_ID);
  const showMode = () => commands.run(MODES_SHOW, 'docs.docs');
  const openDoc = async (path: string) => {
    await showMode();
    sample.openDoc(path, null);
  };
  return {
    beats: [
      { name: 'tree', show: showMode },
      {
        name: 'page',
        show: () => openDoc(paths.join(home, '.claude', 'CLAUDE.md')),
      },
      {
        name: 'skill',
        show: () =>
          openDoc(
            paths.join(
              home,
              'dev',
              'selftest-repo',
              '.claude',
              'skills',
              'demo',
              'SKILL.md',
            ),
          ),
      },
    ],
    dispose: () => sample.dispose(),
  };
}

function sessionTabStage(
  deps: DocsDemoPageDeps,
  context: DemoPageContext,
): DemoStage {
  const { commands } = deps;
  const sessionId = context.sessions.session;
  const showTab = async (tab: string) => {
    await commands.run(sessionsSelectRowCommand, sessionId);
    await commands.run(sessionsSelectTabCommand, { sessionId, tab });
  };
  return {
    beats: [
      { name: 'session', show: () => showTab('chat') },
      { name: 'Docs tab', show: () => showTab('docs') },
    ],
    dispose: () => undefined,
  };
}
