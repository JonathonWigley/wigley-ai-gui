// The page half of a declared workflow: its stages' status, progress, detail,
// activities and actions, its side pane's checklist, and its countdown,
// progress log text and preview samples.

import type {
  ActionDecl,
  ActivityDecl,
  StageDecl,
} from '../../../contracts/contributions';
import type { Paths } from '../../../contracts/paths';
import type { RowActivity } from '../../sessions/contract';
import {
  actionCommandShortId,
  busyStatus,
  checklistCount,
  type DeclaredWorkflow,
  defaultChecklist,
  finishingStatus,
  type PageStage,
  type PageWorkflow,
  type SessionFlow,
  STAGE_ACTIVITY_RANK,
  type StageActionSpec,
  type StageStatus,
  type WorkflowDraw,
} from '../contract';
import { CANCEL_COUNTDOWN_ACTION } from './actions';
import { countdownText } from './countdown-text';
import type { PlanPane } from './plan-pane';
import { previewFlows } from './preview';
import { renderDetail, renderTemplate, templateVariables } from './templates';
import { allHold } from './triggers';

// The plan file a plan folder holds when the plugin's `planFormat` names none.
const DEFAULT_PLAN_FILE = 'plan.md';

export interface PageBuildDeps {
  draw: WorkflowDraw;
  planPane: PlanPane;
  // Runs an action in main, by its short id or `cancelCountdown`.
  runAction(
    sessionId: string,
    action: string,
    flow: SessionFlow,
  ): Promise<void>;
  // Opens a file in Docs mode, for `openPlan`.
  openDoc(path: string): void;
  paths: Pick<Paths, 'join'>;
}

export function buildPageWorkflow(
  workflow: DeclaredWorkflow,
  deps: PageBuildDeps,
): PageWorkflow {
  const { decl, planFormat } = workflow;
  const isPlanPane = decl.sidePane.kind === 'plan';
  const openPlanIds = new Set(
    Object.entries(decl.actions ?? {})
      .filter(([, action]) => action.kind === 'openPlan')
      .map(([actionId]) => actionCommandShortId(workflow.id, actionId)),
  );
  const planCounter =
    decl.fixCycles !== undefined && 'planCounter' in decl.fixCycles
      ? decl.fixCycles.planCounter
      : null;
  return {
    id: workflow.id,
    label: decl.label,
    badge: decl.badge,
    stages: decl.stages.map((stage, index) =>
      pageStage(stage, index, workflow),
    ),
    draw: deps.draw,
    checklist: (flow) =>
      isPlanPane
        ? deps.planPane.checklist(flow, planFormat)
        : defaultChecklist(flow),
    async runAction(sessionId, action, flow) {
      if (!openPlanIds.has(action)) {
        await deps.runAction(sessionId, action, flow);
        return;
      }
      const dir = flow.plan?.dir ?? null;
      if (dir === null) {
        throw new Error('the session has no plan');
      }
      deps.openDoc(deps.paths.join(dir, planFormat?.file ?? DEFAULT_PLAN_FILE));
    },
    countdownText: (flow, now) =>
      flow.countdownEndsAt === null
        ? null
        : countdownText(flow.countdownEndsAt, now),
    progressText: (flow) =>
      isPlanPane ? planProgressText(flow, planCounter) : checklistCount(flow),
    ...(isPlanPane
      ? {
          hasPlan: (flow: SessionFlow) =>
            (flow.plan?.progress ?? null) !== null,
        }
      : {}),
    previewFlows: (sessionId, now) =>
      previewFlows(workflow, sessionId, now, deps.paths),
  };
}

function pageStage(
  stage: StageDecl,
  index: number,
  workflow: DeclaredWorkflow,
): PageStage {
  const chipProgress = stage.chipProgress ?? stage.progress;
  const { progress } = stage;
  return {
    id: stage.id,
    label: stage.label,
    inStepper: stage.inStepper ?? true,
    ...(stage.slot === undefined ? {} : { stepSlot: stage.slot }),
    order: index,
    actions: stageActions(stage, workflow),
    detail: (flow) => renderDetail(stage.detail, flow),
    status: statusOf(stage.status),
    ...(progress === undefined
      ? {}
      : {
          statusProgress: (flow: SessionFlow) => renderTemplate(progress, flow),
        }),
    ...(chipProgress === undefined
      ? {}
      : {
          chipProgress: (flow: SessionFlow) =>
            renderTemplate(chipProgress, flow),
        }),
    ...(stage.runsTasks === undefined ? {} : { runsTasks: stage.runsTasks }),
    ...(stage.rowActivity === undefined
      ? {}
      : { rowActivity: rowActivity(stage.rowActivity) }),
    ...(stage.unseenActivity === undefined
      ? {}
      : { unseenActivity: rowActivity(stage.unseenActivity) }),
  };
}

function statusOf(
  status: StageDecl['status'],
): (flow: SessionFlow) => StageStatus | null {
  switch (status) {
    case 'busy':
      return busyStatus;
    case 'finishing':
      return finishingStatus;
    case 'ready':
      return () => 'ready';
    case 'none':
      return () => null;
  }
}

function rowActivity(activity: ActivityDecl): RowActivity {
  return {
    word: activity.word,
    tone: activity.tone,
    rank: STAGE_ACTIVITY_RANK,
    ...(activity.emphasis === undefined ? {} : { emphasis: activity.emphasis }),
  };
}

// The countdown's Cancel first on an `auto` stage, then each listed action.
function stageActions(
  stage: StageDecl,
  workflow: DeclaredWorkflow,
): StageActionSpec[] {
  const cancel: StageActionSpec[] =
    stage.auto === undefined
      ? []
      : [
          {
            command: CANCEL_COUNTDOWN_ACTION,
            label: 'Cancel',
            available: (flow) => flow.countdownEndsAt !== null,
            enabled: () => true,
          },
        ];
  const listed = (stage.actions ?? []).map((actionId) =>
    actionSpec(actionId, workflow.decl.actions?.[actionId], workflow),
  );
  return [...cancel, ...listed];
}

// The reader guarantees every listed id names an action.
function actionSpec(
  actionId: string,
  action: ActionDecl | undefined,
  workflow: DeclaredWorkflow,
): StageActionSpec {
  const needsPlanDir =
    action?.kind === 'openPlan' ||
    templateVariables(action?.text ?? '').includes('plan');
  return {
    command: actionCommandShortId(workflow.id, actionId),
    label: action?.label ?? actionId,
    ...(action?.keyOnly === true ? { keyOnly: true } : {}),
    available: (flow) =>
      allHold(action?.available, flow) &&
      (!needsPlanDir || (flow.plan?.dir ?? null) !== null),
    enabled: (flow) => allHold(action?.enabled, flow),
  };
}

// `<checked>/<total>`, then ` wave <n>` and ` review <r>` while they apply;
// null while the plan is unread.
function planProgressText(
  flow: SessionFlow,
  planCounter: string | null,
): string | null {
  const progress = flow.plan?.progress ?? null;
  if (progress === null) {
    return null;
  }
  const reviews =
    planCounter === null ? 0 : (progress.counters[planCounter] ?? 0);
  const wave = progress.wave === null ? '' : ` wave ${String(progress.wave)}`;
  const review = reviews > 0 ? ` review ${String(reviews)}` : '';
  return `${String(progress.checked)}/${String(progress.total)}${wave}${review}`;
}
