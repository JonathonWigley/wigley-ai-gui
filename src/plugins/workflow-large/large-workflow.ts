import {
  type MainWorkflow,
  startsSkill,
  type WorkflowSignal,
} from '../workflow/contract';
import { LARGE_WORKFLOW_ID } from './contract';
import { foldLargeState, largeFixCycles, sameLargeState } from './large-state';
import { LARGE_MAIN_STAGES } from './stages';

const CLAIMED_SKILLS = [
  'wigley:feature',
  'wigley:feature-primer',
  'wigley:make',
];

export const largeMainWorkflow: MainWorkflow = {
  id: LARGE_WORKFLOW_ID,
  order: 30,
  claims: (signal: WorkflowSignal) =>
    CLAIMED_SKILLS.some((skill) => startsSkill(signal, skill)),
  firstStage: 'explore',
  stages: LARGE_MAIN_STAGES,
  foldState: foldLargeState,
  sameState: sameLargeState,
  fixCycles: largeFixCycles,
};
