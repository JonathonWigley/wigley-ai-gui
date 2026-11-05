import { type MainStage, startsSkill } from '../../../workflow/contract';

// The first claim sets `firstStage`; this rule moves a second Medium ask in one session
// back here, since a claim by the flow's own workflow leaves the stage where it is.
export const interviewMainStage: MainStage = {
  id: 'interview',
  order: 10,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:medium') ? 'interview' : null;
  },
};
