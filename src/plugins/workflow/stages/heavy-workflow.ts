import {
  type MainWorkflow,
  startsSkill,
  type WorkflowSignal,
} from '../contract';
import { HEAVY_WORKFLOW_ID } from './heavy-contract';
import { foldHeavyState, sameHeavyState } from './heavy-state';
import { BUILT_IN_MAIN_STAGES } from './index';

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
  stages: BUILT_IN_MAIN_STAGES,
  foldState: foldHeavyState,
  sameState: sameHeavyState,
};
