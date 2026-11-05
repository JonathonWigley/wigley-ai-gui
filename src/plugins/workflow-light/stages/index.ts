// Light's stages, each half in stage order, and its main workflow.

import {
  type MainStage,
  type MainWorkflow,
  type PageStage,
  startsSkill,
} from '../../workflow/contract';
import { LIGHT_WORKFLOW_ID } from '../contract';
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

export const LIGHT_MAIN_STAGES: readonly MainStage[] = [
  scopeMainStage,
  buildMainStage,
  checkMainStage,
  landMainStage,
  doneMainStage,
];

export const LIGHT_PAGE_STAGES: readonly PageStage[] = [
  scopePageStage,
  buildPageStage,
  checkPageStage,
  landPageStage,
  donePageStage,
];

export const lightMainWorkflow: MainWorkflow = {
  id: LIGHT_WORKFLOW_ID,
  order: 10,
  claims: (signal) => startsSkill(signal, 'wigley:light'),
  firstStage: 'scope',
  stages: LIGHT_MAIN_STAGES,
};
