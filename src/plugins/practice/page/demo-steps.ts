import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';

// `openProblemRow` is the view's click on a problem's list row.
export interface PracticeDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  openProblemRow(slug: string): void;
}

// The Practice step: Practice mode over the sample folder main serves while
// the step holds it, a problem, then a run of its solution. It never starts
// the interviewer or an import.
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
  const showMode = () => commands.run(MODES_SHOW, 'practice.main');
  const openTwoSum = async () => {
    await showMode();
    deps.openProblemRow('two-sum');
  };
  return {
    beats: [
      { name: 'problem list', show: showMode },
      { name: 'problem', show: openTwoSum },
      {
        name: 'run',
        // The judge compiles the solution before it runs the cases.
        dwellSeconds: 8,
        async show() {
          await openTwoSum();
          await commands.run('practice.run');
        },
      },
    ],
    dispose: () => undefined,
  };
}
