import { type MainStage, startsSkill } from '../../../workflow/contract';
import { largeEventOf, largeStateOf } from '../../contract';

// A review round lights review only when it was logged after make started:
// Resume make from review keeps make until the next round. It lights only from
// make: a round logged in a fix cycle leaves the flow in fix.

export const reviewMainStage: MainStage = {
  id: 'review',
  order: 50,
  enter(flow, signal) {
    const inMake = flow.stage === 'make';
    const startedReview =
      startsSkill(signal, 'wigley:review') && (inMake || flow.stage === 'fix');
    const event = largeEventOf(signal);
    // Large's state fold fills a null reviewRoundsAtMake on every planChanged
    // before the stage rules run; the fallback only satisfies the nullable type.
    const loggedReviewRound =
      inMake &&
      event?.type === 'planChanged' &&
      event.progress.reviewRounds >
        (largeStateOf(flow).reviewRoundsAtMake ?? 0);
    return startedReview || loggedReviewRound ? 'review' : null;
  },
};
