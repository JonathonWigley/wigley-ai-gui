import type { PageApi, PagePart } from '../../../contracts/plugin';
import { docsPageKey } from '../../docs/contract';
import { sessionsActiveSlot } from '../../sessions/contract';
import { keyRunner } from '../../../shared/page/layout-host/base-kit';
import {
  workflowPageKey,
  workflowStageActionCommand,
} from '../../workflow/contract';
import {
  HEAVY_WORKFLOW_ID,
  heavyStateOf,
  type WorkflowHeavyChannel,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowHeavyManifest } from '../manifest';
import type { PlanProgress } from '../../../shared/plan-progress';
import { HEAVY_COMMANDS, HEAVY_PAGE_STAGES } from '../stages';
import { heavyChecklist } from './checklist';
import { countdownText } from './countdown';
import { PREVIEW_SAMPLES, previewFlow } from './preview';

type WorkflowHeavyApi = PageApi<
  typeof workflowHeavyManifest,
  WorkflowHeavyChannel
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

// Heavy's page half on the engine: its stages, its layouts, its checklist from the
// read plan, and what its actions, countdown, progress and preview read from its
// state. Each command runs `workflow.stageAction` on the selected session.
export const workflowHeavyPagePart: PagePart<typeof workflowHeavyManifest> = {
  manifest: workflowHeavyManifest,
  start(api: WorkflowHeavyApi) {
    const { services } = api;
    const { log } = services;
    const workflow = api.dependency(workflowPageKey);
    const docs = api.dependency(docsPageKey);

    workflow.addWorkflow({
      id: HEAVY_WORKFLOW_ID,
      label: 'Heavy',
      badge: 'H',
      stages: HEAVY_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowHeavyManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Plan',
      }),
      checklist: heavyChecklist,
      async runAction(sessionId, command, flow) {
        if (command !== 'openPlan') {
          await api.channel.invoke('runAction', { sessionId, command });
          return;
        }
        const { planDir } = heavyStateOf(flow);
        if (planDir === null) {
          throw new Error('the session has no plan');
        }
        docs.openDoc(services.paths.join(planDir, PLAN_FILE));
      },
      countdownText(flow, now) {
        const { countdownEndsAt } = heavyStateOf(flow);
        return countdownEndsAt === null
          ? null
          : countdownText(countdownEndsAt, now);
      },
      progressText(flow) {
        const { progress } = heavyStateOf(flow);
        return progress === null ? null : progressText(progress);
      },
      hasPlan: (flow) => heavyStateOf(flow).progress !== null,
      previewFlows: (sessionId, now) =>
        PREVIEW_SAMPLES.map((_, index) =>
          previewFlow(index, sessionId, now, api.settings().autoStartSeconds),
        ),
    });

    const runKey = keyRunner(api.commands, log);
    const runOnSelected = (command: keyof typeof HEAVY_COMMANDS) => () => {
      const sessionId = api.state.read(sessionsActiveSlot).get() ?? null;
      if (sessionId === null) {
        log(`no selected session for ${command}`);
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
