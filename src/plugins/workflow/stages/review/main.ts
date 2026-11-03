import { type MainStage, startsSkill } from '../../contract';

// A review round lights review only when it was logged after make started:
// Resume make from review keeps make until the next round.

export const reviewMainStage: MainStage = {
  id: 'review',
  order: 50,
  enter(flow, signal) {
    if (flow.stage !== 'make') {
      return null;
    }
    const startedReview = startsSkill(signal, 'wigley:review');
    // The bookkeeping fills a null or left-out reviewRoundsAtMake on every
    // planChanged before the stage rules run; the fallback only satisfies the
    // optional type.
    const loggedReviewRound =
      signal.type === 'planChanged' &&
      signal.progress.reviewRounds > (flow.reviewRoundsAtMake ?? 0);
    return startedReview || loggedReviewRound ? 'review' : null;
  },
};
