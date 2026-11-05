import {
  type MainWorkflow,
  startsSkill,
  type WorkflowSignal,
} from '../workflow/contract';
import { HEAVY_WORKFLOW_ID } from './contract';
import { foldHeavyState, heavyFixCycles, sameHeavyState } from './heavy-state';
import { HEAVY_MAIN_STAGES } from './stages';

const CLAIMED_SKILLS = [
  'wigley:feature',
  'wigley:feature-primer',
  'wigley:make',
];

export const heavyMainWorkflow: MainWorkflow = {
  id: HEAVY_WORKFLOW_ID,
  order: 30,
  claims: (signal: WorkflowSignal) =>
    CLAIMED_SKILLS.some((skill) => startsSkill(signal, skill)),
  firstStage: 'explore',
  stages: HEAVY_MAIN_STAGES,
  foldState: foldHeavyState,
  sameState: sameHeavyState,
  fixCycles: heavyFixCycles,
};
