// Test helpers around the sample workflows of `sample-workflows.ts`: the
// sample plugin as a reader sees it, an accepted section, and plan states.

import type {
  PlanFormat,
  WorkflowDecl,
} from '../../../contracts/contributions';
import type {
  ContributionSource,
  Strategy,
} from '../../contributions/contract';
import type { PlanProgress, PlanState, PlanTaskLine } from '../contract';
import {
  SAMPLE_AURI_FILE,
  SAMPLE_PLUGIN_NAME,
  sampleDeclared,
} from './sample-workflows';

// The sample's sections as a reader receives them.
export const SAMPLE_WORKFLOWS: readonly WorkflowDecl[] =
  SAMPLE_AURI_FILE.workflows ?? [];
export const SAMPLE_PLAN_FORMAT: PlanFormat = SAMPLE_AURI_FILE.planFormat ?? {};

// Fresh copies of single sample declarations.
export const SAMPLE_SMALL: WorkflowDecl = sampleDeclared('small').decl;
export const SAMPLE_MEDIUM: WorkflowDecl = sampleDeclared('medium').decl;
export const SAMPLE_LARGE: WorkflowDecl = sampleDeclared('large').decl;

// The sample plugin as a reader sees its source.
export const SAMPLE_SOURCE: ContributionSource = {
  pluginName: SAMPLE_PLUGIN_NAME,
  pluginKey: `${SAMPLE_PLUGIN_NAME}@market`,
  version: '1.0.0',
  root: `/plugins/${SAMPLE_PLUGIN_NAME}`,
  harnessId: 'claude',
};

// One accepted section holding `value`, from plugin `pluginName`.
export function strategyOf<V>(pluginName: string, value: V): Strategy<V> {
  return {
    id: pluginName,
    label: pluginName,
    source: {
      pluginName,
      pluginKey: `${pluginName}@market`,
      version: null,
      root: `/plugins/${pluginName}`,
      harnessId: 'claude',
    },
    value,
  };
}

export const SAMPLE_PLAN_DIR = '/r/docs/features/f/plan-x';

// One plan box in group `group`, done when `done`.
export function taskLine(
  text: string,
  done: boolean,
  fields: Partial<PlanTaskLine> = {},
): PlanTaskLine {
  return {
    group: 1,
    text,
    done,
    file: null,
    status: null,
    verification: false,
    ...fields,
  };
}

// A plan at `SAMPLE_PLAN_DIR`, reported, read as `progress`; the counts come
// from `progress.tasks` unless `progress` names them.
export function samplePlan(
  progress: Partial<PlanProgress> | null,
  fields: Partial<PlanState> = {},
): PlanState {
  const tasks = progress?.tasks ?? [];
  return {
    dir: SAMPLE_PLAN_DIR,
    reported: true,
    unreportedDir: null,
    progress:
      progress === null
        ? null
        : {
            title: 'Sample',
            checked: tasks.filter((task) => task.done).length,
            total: tasks.length,
            wave: null,
            counters: {},
            tasks,
            ...progress,
          },
    snapshots: {},
    ...fields,
  };
}
