import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';

// `openProblemRow` is the view's click on a problem's list row. `holdPlace`
// stops `practice.place` writes until its dispose. `saveDrafts` saves every
// unsaved draft now, to the folder main serves.
export interface PracticeDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  openProblemRow(slug: string): void;
  holdPlace(): Disposable;
  saveDrafts(): Promise<void>;
}

// The Practice step: Practice mode over the sample folder main serves while
// the step holds it, a problem, then a run of its solution. It never starts
// the interviewer or an import. It holds the place so the user's saved one
// outlasts the sample, and its dispose saves the sample's drafts before main
// serves the real folder again.
export function registerDemoSteps(
  services: PageServices,
  deps: PracticeDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'practice.mode',
    section: 'modes',
    order: 40,
    title: 'Practice',
    caption:
      'Practice: coding problems with an editor, a C++ judge and an interviewer agent.',
    files: [
      'src/plugins/practice/page/practice-view.ts',
      'src/plugins/practice/page/problem-workspace.ts',
      'src/plugins/practice/main/judge.ts',
      'src/plugins/practice/main/start.ts',
    ],
    enter: async () => practiceStage(deps),
  });
}

function practiceStage(deps: PracticeDemoPageDeps): DemoStage {
  const { commands } = deps;
  const placeHold = deps.holdPlace();
  return {
    beats: [
      {
        name: 'problem',
        async show() {
          await commands.run(MODES_SHOW, 'practice.main');
          deps.openProblemRow('two-sum');
        },
      },
    ],
    async dispose() {
      try {
        await deps.saveDrafts();
      } finally {
        placeHold.dispose();
      }
    },
  };
}
