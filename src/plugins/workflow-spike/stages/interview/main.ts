import {
  type MainStage,
  reportsStep,
  startsSkill,
} from '../../../workflow/contract';

// The first claim sets `firstStage`; this rule moves a second Spike ask, or a new run
// after done, back here, since a claim by the flow's own workflow leaves the stage
// where it is.
export const interviewMainStage: MainStage = {
  id: 'interview',
  order: 10,
  reportedAs: 'interview',
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:spike') ||
      reportsStep(signal, 'interview')
      ? 'interview'
      : null;
  },
};
