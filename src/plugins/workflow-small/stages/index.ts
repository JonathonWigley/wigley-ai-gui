// Small's stages, each half in stage order, and its main workflow.

import {
  type MainStage,
  type MainWorkflow,
  type PageStage,
  startsSkill,
} from '../../workflow/contract';
import { SMALL_WORKFLOW_ID } from '../contract';
import { answeredMainStage } from './answered/main';
import { answeredPageStage } from './answered/page';
import { buildMainStage } from './build/main';
import { buildPageStage } from './build/page';
import { checkMainStage } from './check/main';
import { checkPageStage } from './check/page';
import { doneMainStage } from './done/main';
import { donePageStage } from './done/page';
import { landMainStage } from './land/main';
import { landPageStage } from './land/page';
import { scopeMainStage } from './scope/main';
import { scopePageStage } from './scope/page';

export const SMALL_MAIN_STAGES: readonly MainStage[] = [
  scopeMainStage,
  buildMainStage,
  checkMainStage,
  landMainStage,
  doneMainStage,
  answeredMainStage,
];

export const SMALL_PAGE_STAGES: readonly PageStage[] = [
  scopePageStage,
  buildPageStage,
  checkPageStage,
  landPageStage,
  donePageStage,
  answeredPageStage,
];

export const smallMainWorkflow: MainWorkflow = {
  id: SMALL_WORKFLOW_ID,
  order: 10,
  claims: (signal) => startsSkill(signal, 'wigley:small'),
  firstStage: 'scope',
  stages: SMALL_MAIN_STAGES,
};
