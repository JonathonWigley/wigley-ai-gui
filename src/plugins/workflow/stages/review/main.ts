import type { MainStage } from '../../contract';

export const reviewMainStage: MainStage = {
  id: 'review',
  order: 50,
  enter(flow, signal) {
    if (flow.stage !== 'make') {
      return null;
    }
    const startedReview =
      signal.type === 'skillStarted' && signal.skill === 'wigley:review';
    const loggedReviewRound =
      signal.type === 'planChanged' && signal.progress.reviewRounds > 0;
    return startedReview || loggedReviewRound ? 'review' : null;
  },
};
