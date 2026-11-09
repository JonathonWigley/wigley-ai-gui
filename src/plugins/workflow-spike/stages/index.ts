// Spike's stages, each half in stage order, and its main workflow.

import {
  type MainStage,
  type MainWorkflow,
  type PageStage,
  startsSkill,
} from '../../workflow/contract';
import { SPIKE_WORKFLOW_ID } from '../contract';
import { buildMainStage } from './build/main';
import { buildPageStage } from './build/page';
import { checkMainStage } from './check/main';
import { checkPageStage } from './check/page';
import { doneMainStage } from './done/main';
import { donePageStage } from './done/page';
import { interviewMainStage } from './interview/main';
import { interviewPageStage } from './interview/page';
import { landMainStage } from './land/main';
import { landPageStage } from './land/page';

export const SPIKE_MAIN_STAGES: readonly MainStage[] = [
  interviewMainStage,
  buildMainStage,
  checkMainStage,
  landMainStage,
  doneMainStage,
];

export const SPIKE_PAGE_STAGES: readonly PageStage[] = [
  interviewPageStage,
  buildPageStage,
  checkPageStage,
  landPageStage,
  donePageStage,
];

export const spikeMainWorkflow: MainWorkflow = {
  id: SPIKE_WORKFLOW_ID,
  order: 40,
  claims: (signal) => startsSkill(signal, 'wigley:spike'),
  firstStage: 'interview',
  stages: SPIKE_MAIN_STAGES,
};
