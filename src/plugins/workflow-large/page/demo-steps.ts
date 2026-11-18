import type {
  DemoBeat,
  DemoPageContext,
  DemoStage,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
} from '../../workflow/contract';
import { PREVIEW_SAMPLES, previewFlow, type SamplePlan } from './preview';

// `showSample` is the workflow engine's page export; `autoStartSeconds` reads
// Large's setting of that name.
export interface WorkflowLargePageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
  autoStartSeconds(): number;
}

// The beats: a run early on, then the closed run, each the PREVIEW_SAMPLES row
// of its stage.
const BEATS: readonly {
  name: string;
  stage: (typeof PREVIEW_SAMPLES)[number]['stage'];
}[] = [
  { name: 'Interview', stage: 'interview' },
  { name: 'Closed', stage: 'closed' },
];

// The Large step: two of the layout preview's samples on the demo session,
// over a sample plan in the scratch folder.
export function registerDemoSteps(
  services: PageServices,
  deps: WorkflowLargePageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'workflow-large.run',
    section: 'workflows',
    order: 50,
    title: 'Large workflow',
    caption:
      'Large workflow: a planned feature from primer to plan, then make, review and close',
    files: [
      'src/plugins/workflow-large/main/start.ts',
      'src/plugins/workflow-large/page/start.ts',
      'src/plugins/workflow-large/page/preview.ts',
      'src/plugins/workflow-large/page/countdown.ts',
      'src/plugins/workflow-large/main/countdown.ts',
    ],
    enter: async (context) => largeStage(services, deps, context),
  });
}

function largeStage(
  services: PageServices,
  deps: WorkflowLargePageDemoDeps,
  context: DemoPageContext,
): DemoStage {
  const sessionId = context.sessions.session;
  const autoStartSeconds = deps.autoStartSeconds();
  const plan: SamplePlan = {
    projectDir: context.scratchDir,
    planDir: services.paths.join(
      context.scratchDir,
      'docs',
      'features',
      'daily-quests',
      'plan-daily-quests',
    ),
    title: 'Daily quests',
  };
  const shown = createSampleSequence(deps.showSample);
  return {
    beats: BEATS.map(({ name, stage }): DemoBeat => {
      const index = PREVIEW_SAMPLES.findIndex(
        (sample) => sample.stage === stage,
      );
      return {
        name,
        show: () =>
          shown.show(
            previewFlow(
              index,
              sessionId,
              services.clock.now(),
              autoStartSeconds,
              plan,
            ),
          ),
      };
    }),
    dispose: () => shown.dispose(),
  };
}
