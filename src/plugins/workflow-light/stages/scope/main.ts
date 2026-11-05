import { type MainStage, startsSkill } from '../../../workflow/contract';

// The first claim sets `firstStage`; this rule moves a second Light ask in one session
// back here, since a claim by the flow's own workflow changes nothing.
export const scopeMainStage: MainStage = {
  id: 'scope',
  order: 10,
  enter(_flow, signal) {
    return startsSkill(signal, 'wigley:light') ? 'scope' : null;
  },
};
