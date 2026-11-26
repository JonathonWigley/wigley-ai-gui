// The four sample workflows' demo steps. Each adds only a page half of its
// sample, under the plugin name `demo` (`demo:small`), for the step's life: a
// real `wigley:<id>` may already be added, and a page half claims nothing,
// adds no step, and registers no command or key.

import type {
  DemoBeat,
  DemoPageContext,
  DemoStage,
} from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createSampleSequence,
  type DeclaredWorkflow,
  type PageWorkflow,
  type PlanState,
  type PlanTaskLine,
  type SessionFlow,
  sampleChecklist,
  sampleFlow,
  type WorkflowDraw,
} from '../contract';
import type { PageBuildDeps } from '../declared/build-page';
import { buildPageWorkflow } from '../declared/build-page';
import {
  type SampleWorkflowId,
  sampleDeclared,
} from '../declared/sample-workflows';

// The plugin name the demo's page halves go under.
export const DEMO_PLUGIN_NAME = 'demo';

// `showSample` and `addWorkflow` are the engine's own; `createDraw` draws a
// declared workflow with the declared-draw options; `planPane`, `runAction`
// and `openDoc` are what the engine's declared page halves get.
export interface SampleDemoDeps {
  showSample(flow: SessionFlow): Disposable;
  addWorkflow(workflow: PageWorkflow): Disposable;
  createDraw(workflow: DeclaredWorkflow): WorkflowDraw & Disposable;
  planPane: PageBuildDeps['planPane'];
  runAction: PageBuildDeps['runAction'];
  openDoc: PageBuildDeps['openDoc'];
}

// A beat's sample flow over the demo session, given the qualified workflow id.
type BeatFlow = (
  workflowId: string,
  sessionId: string,
  context: DemoPageContext,
) => SessionFlow;

interface SampleStep {
  id: SampleWorkflowId;
  order: number;
  title: string;
  caption: string;
  beats: readonly { name: string; flow: BeatFlow }[];
}

// A checklist beat: the flow at `stage`, its first `done` of `items` done.
function checklistBeat(
  name: string,
  items: readonly string[],
  fields: { stage: string; done: number; turnRunning: boolean } & Partial<
    Pick<SessionFlow, 'counters'>
  >,
): { name: string; flow: BeatFlow } {
  const { done, ...flowFields } = fields;
  return {
    name,
    flow: (workflowId, sessionId, context) =>
      sampleFlow(sessionId, context.scratchDir, {
        workflow: workflowId,
        checklist: sampleChecklist(items, done),
        ...flowFields,
      }),
  };
}

const SMALL_ITEMS = [
  'Find where the quest timer reads the clock',
  'Fix the drift after a clock change',
  'Run the timer tests',
];

const MEDIUM_ITEMS = [
  'Agree the quest reset rules',
  'Build the reset',
  "Fix the review's findings",
];

const SPIKE_ITEMS = [
  'Agree what the prototype must feel like',
  'Build the quest board prototype',
  'Check it runs',
];

// The sample plan's seven tasks, by the wave each sits under.
const PREVIEW_TASKS: readonly Pick<PlanTaskLine, 'group' | 'text'>[] = [
  { group: 1, text: 'Write the contract' },
  { group: 1, text: 'Read the plan file' },
  { group: 1, text: 'Fold the signals' },
  { group: 2, text: 'Draw the row chip' },
  { group: 2, text: 'Draw the composer strip' },
  { group: 2, text: 'Add the side pane' },
  { group: 3, text: 'Run the self-test' },
];

const LARGE_PLAN_TITLE = 'Daily quests';

// The demo's plan in the scratch folder, `checked` of its tasks done and
// `reviewRounds` review rounds in its Run log; null leaves the flow with no
// plan, as the plan stages before Plan have none.
function largePlan(
  context: DemoPageContext,
  paths: PageServices['paths'],
  reached: { checked: number; reviewRounds: number } | null,
): PlanState | null {
  if (reached === null) {
    return null;
  }
  const tasks = PREVIEW_TASKS.map((task, index): PlanTaskLine => ({
    ...task,
    done: index < reached.checked,
    file: null,
    status: null,
    verification: false,
  }));
  return {
    dir: paths.join(
      context.scratchDir,
      'docs',
      'features',
      'daily-quests',
      'plan-daily-quests',
    ),
    reported: false,
    unreportedDir: null,
    progress: {
      title: LARGE_PLAN_TITLE,
      checked: reached.checked,
      total: tasks.length,
      wave: tasks.find((task) => !task.done)?.group ?? null,
      counters: { reviewRounds: reached.reviewRounds },
      tasks,
    },
    snapshots: {},
  };
}

function sampleSteps(paths: PageServices['paths']): readonly SampleStep[] {
  // A Large beat at `stage`, busy when `turnRunning`, with the plan as far as
  // `reached`.
  const largeBeat = (
    name: string,
    stage: string,
    turnRunning: boolean,
    reached: { checked: number; reviewRounds: number } | null,
  ): { name: string; flow: BeatFlow } => ({
    name,
    flow: (workflowId, sessionId, context) =>
      sampleFlow(sessionId, context.scratchDir, {
        workflow: workflowId,
        stage,
        plan: largePlan(context, paths, reached),
        turnRunning,
      }),
  });
  return [
    {
      id: 'small',
      order: 20,
      title: 'Small workflow',
      caption:
        'Small workflow: a clear change scoped, built, checked and landed in one go',
      beats: [
        checklistBeat('Make', SMALL_ITEMS, {
          stage: 'build',
          done: 1,
          turnRunning: true,
        }),
        checklistBeat('Done', SMALL_ITEMS, {
          stage: 'done',
          done: 3,
          turnRunning: false,
        }),
      ],
    },
    {
      id: 'medium',
      order: 30,
      title: 'Medium workflow',
      caption:
        'Medium workflow: an interview, a build, one review and its fixes, then land',
      beats: [
        checklistBeat('Make', MEDIUM_ITEMS, {
          stage: 'build',
          done: 1,
          counters: { fix: 0 },
          turnRunning: true,
        }),
        checklistBeat('Done', MEDIUM_ITEMS, {
          stage: 'done',
          done: 3,
          counters: { fix: 1 },
          turnRunning: false,
        }),
      ],
    },
    {
      id: 'spike',
      order: 40,
      title: 'Spike workflow',
      caption:
        'Spike workflow: a throwaway prototype, built and checked fast for the user to try',
      beats: [
        checklistBeat('Make', SPIKE_ITEMS, {
          stage: 'build',
          done: 1,
          turnRunning: true,
        }),
        checklistBeat('Done', SPIKE_ITEMS, {
          stage: 'done',
          done: 3,
          turnRunning: false,
        }),
      ],
    },
    {
      id: 'large',
      order: 50,
      title: 'Large workflow',
      caption:
        'Large workflow: a planned feature from primer to plan, then make, review and close',
      beats: [
        largeBeat('Interview', 'interview', true, null),
        largeBeat('Closed', 'closed', false, { checked: 7, reviewRounds: 1 }),
      ],
    },
  ];
}

const FILES = [
  'src/plugins/workflow/declared/fixtures/sample-auri.json',
  'src/plugins/workflow/declared/sample-workflows.ts',
  'src/plugins/workflow/page/sample-demo-steps.ts',
  'src/plugins/workflow/declared/build-page.ts',
  'src/plugins/workflow/declared/build-main.ts',
];

// Registers the `workflow.small`, `workflow.medium`, `workflow.spike` and
// `workflow.large` demo steps.
export function registerSampleDemoSteps(
  services: PageServices,
  deps: SampleDemoDeps,
): Disposable {
  const registered = sampleSteps(services.paths).map((step) =>
    services.demoSteps.register({
      id: `workflow.${step.id}`,
      section: 'workflows',
      order: step.order,
      title: step.title,
      caption: step.caption,
      files: FILES,
      enter: async (context) => sampleStage(services, deps, step, context),
    }),
  );
  return {
    dispose: () => callEach(registered, (each) => each.dispose()),
  };
}

// Adds the step's demo page half, then shows each beat's sample on the demo
// session; the dispose takes the sample down before the half and its draw.
function sampleStage(
  services: PageServices,
  deps: SampleDemoDeps,
  step: SampleStep,
  context: DemoPageContext,
): DemoStage {
  const workflow = sampleDeclared(step.id, DEMO_PLUGIN_NAME);
  const draw = deps.createDraw(workflow);
  const half = deps.addWorkflow(
    buildPageWorkflow(workflow, {
      draw,
      planPane: deps.planPane,
      runAction: deps.runAction,
      openDoc: deps.openDoc,
      paths: services.paths,
    }),
  );
  const sessionId = context.sessions.session;
  const shown = createSampleSequence(deps.showSample);
  return {
    beats: step.beats.map(({ name, flow }): DemoBeat => ({
      name,
      show: () => shown.show(flow(workflow.id, sessionId, context)),
    })),
    dispose: () =>
      callEach<Disposable>([shown, half, draw], (each) => each.dispose()),
  };
}
