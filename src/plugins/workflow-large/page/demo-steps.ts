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

// One beat name per PREVIEW_SAMPLES row, in its order.
export const LARGE_BEAT_NAMES: readonly string[] = [
  'Idle',
  'Primer',
  'Explore',
  'Interview',
  'Plan',
  'Cold read',
  'Plan ready',
  'Countdown',
  'Make',
  'Make idle',
  'Review',
  'Fix',
  'Closed',
];

// The Large step: the layout preview's samples on the demo session, over a
// sample plan in the scratch folder. The countdown beat dwells until it runs
// out, and starts nothing: main's auto-start runs only for a stored flow.
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
    beats: PREVIEW_SAMPLES.map(({ countdown }, index): DemoBeat => {
      const show = () =>
        shown.show(
          previewFlow(
            index,
            sessionId,
            services.clock.now(),
            autoStartSeconds,
            plan,
          ),
        );
      const name = LARGE_BEAT_NAMES[index];
      return countdown
        ? { name, dwellSeconds: autoStartSeconds, show }
        : { name, show };
    }),
    dispose: () => shown.dispose(),
  };
}
