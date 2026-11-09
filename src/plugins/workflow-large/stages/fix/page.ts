import {
  busyStatus,
  detailLine,
  type PageStage,
} from '../../../workflow/contract';
import { largeStateOf } from '../../contract';
import { OPEN_PLAN_ACTION, RESUME_MAKE_ACTION } from '../stage-parts';

export const fixPageStage: PageStage = {
  id: 'fix',
  label: 'Fix',
  inStepper: true,
  order: 55,
  actions: [RESUME_MAKE_ACTION, OPEN_PLAN_ACTION],
  detail(flow) {
    const { progress } = largeStateOf(flow);
    if (progress === null) {
      return '';
    }
    const cycle =
      progress.reviewRounds === 0 ? '' : `cycle ${progress.reviewRounds}`;
    return detailLine(
      cycle,
      `${progress.checked}/${progress.total}`,
      progress.title,
    );
  },
  status: busyStatus,
  statusProgress(flow) {
    const rounds = largeStateOf(flow).progress?.reviewRounds ?? 0;
    return rounds === 0 ? '' : ` · cycle ${rounds}`;
  },
};
