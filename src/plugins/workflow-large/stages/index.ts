// Large's stages, each half in stage order, and the commands their keys run. A
// stage action's button runs `workflow.stageAction` with the same short id.

import type { CommandDecl } from '../../../contracts/plugin';
import type { PageStage } from '../../workflow/contract';
import { closedMainStage } from './closed/main';
import { closedPageStage } from './closed/page';
import { coldReadMainStage } from './cold-read/main';
import { coldReadPageStage } from './cold-read/page';
import { exploreMainStage } from './explore/main';
import { explorePageStage } from './explore/page';
import { fixMainStage } from './fix/main';
import { fixPageStage } from './fix/page';
import type { LargeMainStage } from '../contract';
import { idleMainStage } from './idle/main';
import { idlePageStage } from './idle/page';
import { interviewMainStage } from './interview/main';
import { interviewPageStage } from './interview/page';
import { makeMainStage } from './make/main';
import { makePageStage } from './make/page';
import { planMainStage } from './plan/main';
import { planPageStage } from './plan/page';
import { planReadyMainStage } from './plan-ready/main';
import { planReadyPageStage } from './plan-ready/page';
import { primerMainStage } from './primer/main';
import { primerPageStage } from './primer/page';
import { reviewMainStage } from './review/main';
import { reviewPageStage } from './review/page';

export const LARGE_MAIN_STAGES: readonly LargeMainStage[] = [
  idleMainStage,
  primerMainStage,
  exploreMainStage,
  interviewMainStage,
  planMainStage,
  coldReadMainStage,
  planReadyMainStage,
  makeMainStage,
  reviewMainStage,
  fixMainStage,
  closedMainStage,
];

export const LARGE_PAGE_STAGES: readonly PageStage[] = [
  idlePageStage,
  primerPageStage,
  explorePageStage,
  interviewPageStage,
  planPageStage,
  coldReadPageStage,
  planReadyPageStage,
  makePageStage,
  reviewPageStage,
  fixPageStage,
  closedPageStage,
];

export const LARGE_COMMANDS = {
  clearAndMake: {
    label: 'clear the session and make the plan',
    group: 'workflow',
    runsIn: 'page',
    risky: true,
    targets: true,
  },
  cancelCountdown: {
    label: 'cancel the auto-start',
    group: 'workflow',
    runsIn: 'page',
    targets: true,
  },
  makeInNewSession: {
    label: 'make the plan in a new session',
    group: 'workflow',
    runsIn: 'page',
    targets: true,
  },
  resumeMake: {
    label: 'clear the session and resume make',
    group: 'workflow',
    runsIn: 'page',
    risky: true,
    targets: true,
  },
  openPlan: { label: 'open the plan', group: 'workflow', runsIn: 'page' },
  retro: {
    label: 'run a retro',
    group: 'workflow',
    runsIn: 'page',
    targets: true,
  },
  dismiss: {
    label: 'dismiss the closed run',
    group: 'workflow',
    runsIn: 'page',
    targets: true,
  },
} as const satisfies Record<string, CommandDecl>;
