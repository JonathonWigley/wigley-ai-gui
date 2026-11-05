import { busyStatus, detailLine, type PageStage } from '../../contract';
import { heavyStateOf } from '../heavy-contract';
import { OPEN_PLAN_ACTION, RESUME_MAKE_ACTION } from '../stage-parts';

export const reviewPageStage: PageStage = {
  id: 'review',
  label: 'Review',
  inStepper: true,
  order: 50,
  actions: [RESUME_MAKE_ACTION, OPEN_PLAN_ACTION],
  detail(flow) {
    const { progress } = heavyStateOf(flow);
    if (progress === null) {
      return '';
    }
    const round =
      progress.reviewRounds === 0 ? '' : `round ${progress.reviewRounds}`;
    return detailLine(
      round,
      `${progress.checked}/${progress.total}`,
      progress.title,
    );
  },
  status: busyStatus,
  statusProgress(flow) {
    const rounds = heavyStateOf(flow).progress?.reviewRounds ?? 0;
    return rounds === 0 ? '' : ` · round ${rounds}`;
  },
};
