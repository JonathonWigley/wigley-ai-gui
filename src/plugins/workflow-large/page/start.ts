import type {
  PageApi,
  PageCommandContext,
  PagePart,
} from '../../../contracts/plugin';
import { docsPageKey } from '../../docs/contract';
import { sessionsPageKey } from '../../sessions/contract';
import { keyRunner } from '../../../shared/page/layout-host/base-kit';
import {
  workflowPageKey,
  workflowStageActionCommand,
} from '../../workflow/contract';
import {
  LARGE_WORKFLOW_ID,
  largeStateOf,
  type WorkflowLargeChannel,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowLargeManifest } from '../manifest';
import type { PlanProgress } from '../../../shared/plan-progress';
import { LARGE_COMMANDS, LARGE_PAGE_STAGES } from '../stages';
import { largeChecklist } from './checklist';
import { countdownText } from './countdown';
import { registerDemoSteps } from './demo-steps';
import { PREVIEW_SAMPLES, previewFlow } from './preview';

type WorkflowLargeApi = PageApi<
  typeof workflowLargeManifest,
  WorkflowLargeChannel
>;

const PLAN_FILE = 'plan.md';

// `<checked>/<total>`, then ` wave <n>` while a wave is open and
// ` review <r>` once a review round is logged.
function progressText(progress: PlanProgress): string {
  const wave = progress.wave === null ? '' : ` wave ${progress.wave}`;
  const review =
    progress.reviewRounds > 0 ? ` review ${progress.reviewRounds}` : '';
  return `${progress.checked}/${progress.total}${wave}${review}`;
}

// Large's page half on the engine: its stages, its layouts, its checklist from the
// read plan, and what its actions, countdown, progress and preview read from its
// state. Each command runs `workflow.stageAction` on the run's target when it
// names one, else on the session Sessions mode shows. Registers the
// `workflow-large.run` demo step, which shows the preview's samples.
export const workflowLargePagePart: PagePart<typeof workflowLargeManifest> = {
  manifest: workflowLargeManifest,
  start(api: WorkflowLargeApi) {
    const { services } = api;
    const { log } = services;
    const workflow = api.dependency(workflowPageKey);
    const docs = api.dependency(docsPageKey);
    const sessions = api.dependency(sessionsPageKey);

    workflow.addWorkflow({
      id: LARGE_WORKFLOW_ID,
      label: 'Large',
      badge: 'L',
      stages: LARGE_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowLargeManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Plan',
      }),
      checklist: largeChecklist,
      async runAction(sessionId, command, flow) {
        if (command !== 'openPlan') {
          await api.channel.invoke('runAction', { sessionId, command });
          return;
        }
        const { planDir } = largeStateOf(flow);
        if (planDir === null) {
          throw new Error('the session has no plan');
        }
        docs.openDoc(services.paths.join(planDir, PLAN_FILE));
      },
      countdownText(flow, now) {
        const { countdownEndsAt } = largeStateOf(flow);
        return countdownEndsAt === null
          ? null
          : countdownText(countdownEndsAt, now);
      },
      progressText(flow) {
        const { progress } = largeStateOf(flow);
        return progress === null ? null : progressText(progress);
      },
      hasPlan: (flow) => largeStateOf(flow).progress !== null,
      previewFlows: (sessionId, now) =>
        PREVIEW_SAMPLES.map((_, index) =>
          previewFlow(index, sessionId, now, api.settings().autoStartSeconds),
        ),
    });
    registerDemoSteps(services, {
      showSample: (flow) => workflow.showSample(flow),
    });

    const runKey = keyRunner(api.commands, log);
    // Acts on the run's target when it names one; else on the session
    // Sessions mode shows: in any other mode the key belongs to that mode, so
    // it does nothing.
    const runOnSelected =
      (command: keyof typeof LARGE_COMMANDS) =>
      ({ targetSessionId }: PageCommandContext) => {
        const sessionId = targetSessionId ?? sessions.shownSessionId();
        if (sessionId === null) {
          log(`no shown session for ${command}`);
          return;
        }
        runKey(workflowStageActionCommand, { sessionId, action: command });
      };

    return {
      commands: {
        clearAndMake: runOnSelected('clearAndMake'),
        cancelCountdown: runOnSelected('cancelCountdown'),
        makeInNewSession: runOnSelected('makeInNewSession'),
        resumeMake: runOnSelected('resumeMake'),
        openPlan: runOnSelected('openPlan'),
        retro: runOnSelected('retro'),
        dismiss: runOnSelected('dismiss'),
      },
    };
  },
};
