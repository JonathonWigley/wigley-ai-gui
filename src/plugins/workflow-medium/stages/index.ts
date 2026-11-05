// Medium's stages, each half in stage order, and its main workflow.

import {
  type MainStage,
  type MainWorkflow,
  type PageStage,
  startsSkill,
} from '../../workflow/contract';
import { MEDIUM_WORKFLOW_ID } from '../contract';
import { foldMediumState, mediumFixCycles } from '../medium-state';
import { buildMainStage } from './build/main';
import { buildPageStage } from './build/page';
import { doneMainStage } from './done/main';
import { donePageStage } from './done/page';
import { fixMainStage } from './fix/main';
import { fixPageStage } from './fix/page';
import { interviewMainStage } from './interview/main';
import { interviewPageStage } from './interview/page';
import { landMainStage } from './land/main';
import { landPageStage } from './land/page';
import { reviewMainStage } from './review/main';
import { reviewPageStage } from './review/page';

export const MEDIUM_MAIN_STAGES: readonly MainStage[] = [
  interviewMainStage,
  buildMainStage,
  reviewMainStage,
  fixMainStage,
  landMainStage,
  doneMainStage,
];

export const MEDIUM_PAGE_STAGES: readonly PageStage[] = [
  interviewPageStage,
  buildPageStage,
  reviewPageStage,
  fixPageStage,
  landPageStage,
  donePageStage,
];

export const mediumMainWorkflow: MainWorkflow = {
  id: MEDIUM_WORKFLOW_ID,
  order: 20,
  claims: (signal) => startsSkill(signal, 'wigley:medium'),
  firstStage: 'interview',
  stages: MEDIUM_MAIN_STAGES,
  foldState: foldMediumState,
  fixCycles: mediumFixCycles,
};
