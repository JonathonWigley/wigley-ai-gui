// The built-in stages, each half in stage order, and the commands their
// actions and keys run.

import type { CommandDecl } from '../../../contracts/plugin';
import type { PageStage } from '../contract';
import { closedMainStage } from './closed/main';
import { closedPageStage } from './closed/page';
import { coldReadMainStage } from './cold-read/main';
import { coldReadPageStage } from './cold-read/page';
import { exploreMainStage } from './explore/main';
import { explorePageStage } from './explore/page';
import { fixMainStage } from './fix/main';
import { fixPageStage } from './fix/page';
import type { HeavyMainStage } from './heavy-contract';
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

export const BUILT_IN_MAIN_STAGES: readonly HeavyMainStage[] = [
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

export const BUILT_IN_PAGE_STAGES: readonly PageStage[] = [
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

export const WORKFLOW_COMMANDS = {
  mainAction: {
    label: "run the stage's next step",
    group: 'workflow',
    runsIn: 'page',
  },
  clearAndMake: {
    label: 'clear the session and make the plan',
    group: 'workflow',
    runsIn: 'page',
  },
  cancelCountdown: {
    label: 'cancel the auto-start',
    group: 'workflow',
    runsIn: 'page',
  },
  makeInNewSession: {
    label: 'make the plan in a new session',
    group: 'workflow',
    runsIn: 'page',
  },
  resumeMake: {
    label: 'clear the session and resume make',
    group: 'workflow',
    runsIn: 'page',
  },
  openPlan: { label: 'open the plan', group: 'workflow', runsIn: 'page' },
  retro: { label: 'run a retro', group: 'workflow', runsIn: 'page' },
  dismiss: {
    label: 'dismiss the closed run',
    group: 'workflow',
    runsIn: 'page',
  },
} as const satisfies Record<string, CommandDecl>;
