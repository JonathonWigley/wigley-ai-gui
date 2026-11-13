import {
  busyStatus,
  detailLine,
  type PageStage,
  type SessionFlow,
} from '../../../workflow/contract';
import {
  buildProgress,
  type PlanProgress,
} from '../../../../shared/plan-progress';
import { largeStateOf } from '../../contract';
import { OPEN_PLAN_ACTION, RESUME_MAKE_ACTION } from '../stage-parts';

// `<checked>/<total>` over the tasks make builds before its review.
function buildCount(progress: PlanProgress): string {
  const { checked, total } = buildProgress(progress);
  return `${checked}/${total}`;
}

// The build count after the stage's word; '' until the plan is read.
function buildCountAfterLabel(flow: SessionFlow): string {
  const { progress } = largeStateOf(flow);
  return progress === null ? '' : ` ${buildCount(progress)}`;
}

export const makePageStage: PageStage = {
  id: 'make',
  label: 'Make',
  inStepper: true,
  stepSlot: 'make',
  runsTasks: true,
  order: 40,
  actions: [RESUME_MAKE_ACTION, OPEN_PLAN_ACTION],
  detail(flow) {
    const { progress } = largeStateOf(flow);
    if (progress === null) {
      return '';
    }
    const wave = progress.wave === null ? '' : `wave ${progress.wave}`;
    return detailLine(buildCount(progress), wave, progress.title);
  },
  status: busyStatus,
  statusProgress: buildCountAfterLabel,
  chipProgress: buildCountAfterLabel,
};
