// The `workflows` section of `auri.json`: every declaration checked to
// docs/features/feature-contributions/design.md § Section: workflows, and the
// enabled declared workflows built from the accepted sections.

import {
  ACTION_KINDS,
  type ActionDecl,
  ACTIVITY_TONES,
  type ActivityTone,
  NAMED_PREDICATES,
  type PlanFormat,
  qualifiedWorkflowId,
  ROW_EMPHASES,
  SIDE_PANE_KINDS,
  STAGE_STATUSES,
  type WorkflowDecl,
} from '../../../contracts/contributions';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import type { FeatureReader, Strategy } from '../../contributions/contract';
import { CHECKLIST_WORKFLOW, type DeclaredWorkflow } from '../contract';
import { isTemplateVariable, templateVariables } from './templates';

// A workflow or action id: it travels in a command's short id.
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

// The Checklist flow's order; every declared workflow sorts before it.
const CHECKLIST_ORDER = CHECKLIST_WORKFLOW.order;

// The declared values, widened to strings to test a parsed value against.
const STATUSES: readonly string[] = STAGE_STATUSES;
const TONES: readonly string[] = ACTIVITY_TONES;
const EMPHASES: readonly string[] = ROW_EMPHASES;
const PREDICATE_NAMES: readonly string[] = NAMED_PREDICATES;
const KINDS: readonly string[] = ACTION_KINDS;
// The kinds main runs, so the countdown can run them.
const AUTO_KINDS: readonly ActionDecl['kind'][] = [
  'send',
  'clearAndSend',
  'launch',
  'event',
];
const TEXT_KINDS: readonly ActionDecl['kind'][] = [
  'send',
  'clearAndSend',
  'launch',
];
const PANE_KINDS: readonly string[] = SIDE_PANE_KINDS;

// Each reason starts with its path in the section: `[2].stages[4].enter[0]: …`.
// One reason refuses the whole section.
export const workflowsReader: FeatureReader<WorkflowDecl[]> = {
  label: 'Workflows',
  read(section) {
    if (!Array.isArray(section)) {
      return { ok: false, reasons: ['not an array of workflow declarations'] };
    }
    const reasons: string[] = [];
    const seenIds = new Map<string, number>();
    section.forEach((workflow, index) => {
      const path = `[${index}]`;
      if (!isJsonObject(workflow)) {
        reasons.push(`${path}: not an object`);
        return;
      }
      checkWorkflow(workflow, path, reasons);
      const { id } = workflow;
      if (typeof id === 'string') {
        const first = seenIds.get(id);
        if (first !== undefined) {
          reasons.push(`${path}.id: ${id} is already declared at [${first}]`);
        } else {
          seenIds.set(id, index);
        }
      }
    });
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    // Every check above passed, so each declaration holds the declared shape.
    return { ok: true, value: section as WorkflowDecl[] };
  },
};

// The declared workflows the accepted sections hold, in source order and each
// section's array order, less every qualified id `off` lists. Each takes the
// `planFormat` of its own plugin, else null.
export function declaredWorkflows(
  workflows: readonly Strategy<WorkflowDecl[]>[],
  planFormats: readonly Strategy<PlanFormat>[],
  off: readonly string[],
): DeclaredWorkflow[] {
  const declared: DeclaredWorkflow[] = [];
  for (const strategy of workflows) {
    const planFormat =
      planFormats.find((format) => format.id === strategy.id)?.value ?? null;
    for (const decl of strategy.value) {
      const id = qualifiedWorkflowId(strategy.id, decl.id);
      if (!off.includes(id)) {
        declared.push({ id, pluginName: strategy.id, decl, planFormat });
      }
    }
  }
  return declared;
}

// The names one workflow's `from`, `actions` and `auto` checks read against.
interface WorkflowNames {
  stageIds: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  actions: ReadonlyMap<string, unknown>;
  counters: ReadonlySet<string>;
}

function checkWorkflow(
  workflow: JsonObject,
  path: string,
  reasons: string[],
): void {
  if (typeof workflow.id !== 'string' || !ID_PATTERN.test(workflow.id)) {
    reasons.push(`${path}.id: not a letter followed by letters and digits`);
  }
  checkNonEmptyString(workflow.label, `${path}.label`, reasons);
  checkNonEmptyString(workflow.badge, `${path}.badge`, reasons);
  if (workflow.badgeColor !== undefined) {
    checkNonEmptyString(workflow.badgeColor, `${path}.badgeColor`, reasons);
  }
  const isOrderBelowChecklist =
    typeof workflow.order === 'number' && workflow.order < CHECKLIST_ORDER;
  if (!isOrderBelowChecklist) {
    reasons.push(`${path}.order: not a number below ${CHECKLIST_ORDER}`);
  }
  checkSidePane(workflow.sidePane, `${path}.sidePane`, reasons);
  checkTrueFlag(
    workflow.flagsUnclaimedWork,
    `${path}.flagsUnclaimedWork`,
    reasons,
  );
  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    reasons.push(`${path}.stages: not a non-empty array of stages`);
    return;
  }
  const stages = workflow.stages;
  const stageIds = checkStageIds(stages, path, reasons);
  const groups = checkGroups(workflow.groups, stageIds, path, reasons);
  const counters = checkCounters(workflow.counters, stageIds, path, reasons);
  checkFixCycles(workflow.fixCycles, counters, path, reasons);
  const actions = checkActions(workflow.actions, path, reasons);
  const names: WorkflowNames = { stageIds, groups, actions, counters };
  stages.forEach((stage, index) => {
    if (isJsonObject(stage)) {
      checkStage(stage, `${path}.stages[${index}]`, names, reasons);
    }
  });
  checkClaims(workflow.claims, stages, path, reasons);
}

// The stage ids, each checked to be a unique non-empty string.
function checkStageIds(
  stages: readonly unknown[],
  path: string,
  reasons: string[],
): Set<string> {
  const ids = new Set<string>();
  stages.forEach((stage, index) => {
    const stagePath = `${path}.stages[${index}]`;
    if (!isJsonObject(stage)) {
      reasons.push(`${stagePath}: not an object`);
      return;
    }
    if (typeof stage.id !== 'string' || stage.id === '') {
      reasons.push(`${stagePath}.id: not a non-empty string`);
    } else if (ids.has(stage.id)) {
      reasons.push(`${stagePath}.id: ${stage.id} is already a stage`);
    } else {
      ids.add(stage.id);
    }
  });
  return ids;
}

function checkGroups(
  groups: unknown,
  stageIds: ReadonlySet<string>,
  path: string,
  reasons: string[],
): Set<string> {
  const names = new Set<string>();
  if (groups === undefined) {
    return names;
  }
  if (!isJsonObject(groups)) {
    reasons.push(`${path}.groups: not an object`);
    return names;
  }
  for (const [name, members] of Object.entries(groups)) {
    const groupPath = `${path}.groups.${name}`;
    names.add(name);
    if (stageIds.has(name)) {
      reasons.push(`${groupPath}: a group is named like a stage`);
    }
    if (!isStringArray(members)) {
      reasons.push(`${groupPath}: not an array of stage ids`);
      continue;
    }
    for (const member of members) {
      if (!stageIds.has(member)) {
        reasons.push(`${groupPath}: ${member} is not a stage`);
      }
    }
  }
  return names;
}

function checkCounters(
  counters: unknown,
  stageIds: ReadonlySet<string>,
  path: string,
  reasons: string[],
): Set<string> {
  const names = new Set<string>();
  if (counters === undefined) {
    return names;
  }
  if (!isJsonObject(counters)) {
    reasons.push(`${path}.counters: not an object`);
    return names;
  }
  for (const [name, counter] of Object.entries(counters)) {
    const counterPath = `${path}.counters.${name}`;
    names.add(name);
    if (!isJsonObject(counter)) {
      reasons.push(`${counterPath}: not an object`);
      continue;
    }
    if (typeof counter.counts !== 'string' || !stageIds.has(counter.counts)) {
      reasons.push(`${counterPath}.counts: not a stage id`);
    }
    if (counter.resetOn !== 'claim') {
      reasons.push(`${counterPath}.resetOn: not claim`);
    }
  }
  return names;
}

function checkFixCycles(
  fixCycles: unknown,
  counters: ReadonlySet<string>,
  path: string,
  reasons: string[],
): void {
  if (fixCycles === undefined) {
    return;
  }
  const fixPath = `${path}.fixCycles`;
  if (!isJsonObject(fixCycles)) {
    reasons.push(`${fixPath}: not an object`);
    return;
  }
  if ('counter' in fixCycles) {
    const { counter } = fixCycles;
    if (typeof counter !== 'string' || !counters.has(counter)) {
      reasons.push(`${fixPath}.counter: not a counter of the workflow`);
    }
    return;
  }
  if (
    typeof fixCycles.planCounter !== 'string' ||
    fixCycles.planCounter === ''
  ) {
    reasons.push(`${fixPath}: names neither a counter nor a planCounter`);
  }
}

function checkSidePane(sidePane: unknown, path: string, reasons: string[]) {
  if (!isJsonObject(sidePane)) {
    reasons.push(`${path}: not an object`);
    return;
  }
  if (!PANE_KINDS.includes(sidePane.kind as string)) {
    reasons.push(`${path}.kind: not checklist or plan`);
  }
  checkNonEmptyString(sidePane.title, `${path}.title`, reasons);
}

// The actions by id, each checked; an unreadable `actions` gives none.
function checkActions(
  actions: unknown,
  path: string,
  reasons: string[],
): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  if (actions === undefined) {
    return byId;
  }
  if (!isJsonObject(actions)) {
    reasons.push(`${path}.actions: not an object`);
    return byId;
  }
  for (const [id, action] of Object.entries(actions)) {
    const actionPath = `${path}.actions.${id}`;
    byId.set(id, action);
    if (!ID_PATTERN.test(id)) {
      reasons.push(
        `${actionPath}: the id is not a letter followed by letters and digits`,
      );
    }
    if (!isJsonObject(action)) {
      reasons.push(`${actionPath}: not an object`);
      continue;
    }
    checkAction(action, actionPath, reasons);
  }
  return byId;
}

function checkAction(action: JsonObject, path: string, reasons: string[]) {
  const kind = action.kind as ActionDecl['kind'];
  if (!KINDS.includes(kind)) {
    reasons.push(`${path}.kind: not one of ${KINDS.join(', ')}`);
  }
  checkNonEmptyString(action.label, `${path}.label`, reasons);
  if (TEXT_KINDS.includes(kind)) {
    checkNonEmptyString(action.text, `${path}.text`, reasons);
  } else if (action.text !== undefined) {
    reasons.push(`${path}.text: only send, clearAndSend and launch take text`);
  }
  if (typeof action.text === 'string') {
    checkTemplate(action.text, `${path}.text`, true, reasons);
  }
  if (kind === 'event') {
    checkNonEmptyString(action.event, `${path}.event`, reasons);
  }
  if (action.then !== undefined) {
    if (kind !== 'launch') {
      reasons.push(`${path}.then: only launch takes then`);
    } else {
      checkNonEmptyString(action.then, `${path}.then`, reasons);
    }
  }
  checkTrueFlag(action.keyOnly, `${path}.keyOnly`, reasons);
  checkTrueFlag(action.risky, `${path}.risky`, reasons);
  if (action.key !== undefined) {
    checkNonEmptyString(action.key, `${path}.key`, reasons);
  }
  checkPredicates(action.available, `${path}.available`, reasons);
  checkPredicates(action.enabled, `${path}.enabled`, reasons);
}

function checkStage(
  stage: JsonObject,
  path: string,
  names: WorkflowNames,
  reasons: string[],
): void {
  checkNonEmptyString(stage.label, `${path}.label`, reasons);
  for (const field of ['step', 'slot'] as const) {
    if (stage[field] !== undefined) {
      checkNonEmptyString(stage[field], `${path}.${field}`, reasons);
    }
  }
  for (const field of [
    'inStepper',
    'runsTasks',
    'finishes',
    'reopens',
  ] as const) {
    if (stage[field] !== undefined && typeof stage[field] !== 'boolean') {
      reasons.push(`${path}.${field}: not a boolean`);
    }
  }
  if (!STATUSES.includes(stage.status as string)) {
    reasons.push(`${path}.status: not one of ${STATUSES.join(', ')}`);
  }
  if (stage.reopens === true && stage.finishes !== true) {
    reasons.push(`${path}.reopens: only a stage that finishes reopens`);
  }
  if (stage.records !== undefined && !isStringArray(stage.records)) {
    reasons.push(`${path}.records: not an array of plan counter names`);
  }
  checkStageTemplates(stage, path, reasons);
  checkActivity(stage.rowActivity, `${path}.rowActivity`, reasons);
  checkActivity(stage.unseenActivity, `${path}.unseenActivity`, reasons);
  checkStageActions(stage, path, names, reasons);
  if (!Array.isArray(stage.enter)) {
    reasons.push(`${path}.enter: not an array of triggers`);
    return;
  }
  stage.enter.forEach((trigger, index) =>
    checkTrigger(trigger, `${path}.enter[${index}]`, names, reasons),
  );
}

function checkStageTemplates(
  stage: JsonObject,
  path: string,
  reasons: string[],
): void {
  for (const field of ['progress', 'chipProgress'] as const) {
    const template = stage[field];
    if (template === undefined) {
      continue;
    }
    if (typeof template !== 'string') {
      reasons.push(`${path}.${field}: not a string`);
    } else {
      checkTemplate(template, `${path}.${field}`, false, reasons);
    }
  }
  if (stage.detail === undefined) {
    return;
  }
  if (!isStringArray(stage.detail)) {
    reasons.push(`${path}.detail: not an array of templates`);
    return;
  }
  stage.detail.forEach((part, index) =>
    checkTemplate(part, `${path}.detail[${index}]`, false, reasons),
  );
}

function checkStageActions(
  stage: JsonObject,
  path: string,
  names: WorkflowNames,
  reasons: string[],
): void {
  if (stage.actions !== undefined) {
    if (!isStringArray(stage.actions)) {
      reasons.push(`${path}.actions: not an array of action ids`);
    } else {
      for (const id of stage.actions) {
        if (!names.actions.has(id)) {
          reasons.push(`${path}.actions: ${id} is not an action`);
        }
      }
    }
  }
  if (stage.auto === undefined) {
    return;
  }
  const action = names.actions.get(stage.auto as string);
  if (typeof stage.auto !== 'string' || action === undefined) {
    reasons.push(`${path}.auto: not an action`);
    return;
  }
  const kind = isJsonObject(action) ? action.kind : undefined;
  if (!AUTO_KINDS.includes(kind as ActionDecl['kind'])) {
    reasons.push(
      `${path}.auto: ${stage.auto} is not a ${AUTO_KINDS.join(', ')} action`,
    );
  }
}

function checkActivity(activity: unknown, path: string, reasons: string[]) {
  if (activity === undefined) {
    return;
  }
  if (!isJsonObject(activity)) {
    reasons.push(`${path}: not an object`);
    return;
  }
  checkNonEmptyString(activity.word, `${path}.word`, reasons);
  if (!TONES.includes(activity.tone as ActivityTone)) {
    reasons.push(`${path}.tone: not one of ${TONES.join(', ')}`);
  }
  const hasBadEmphasis =
    activity.emphasis !== undefined &&
    !EMPHASES.includes(activity.emphasis as string);
  if (hasBadEmphasis) {
    reasons.push(`${path}.emphasis: not raised or urgent`);
  }
}

function checkTrigger(
  trigger: unknown,
  path: string,
  names: WorkflowNames,
  reasons: string[],
): void {
  if (!isJsonObject(trigger)) {
    reasons.push(`${path}: not an object`);
    return;
  }
  const kinds = (['skill', 'step', 'event'] as const).filter(
    (kind) => trigger[kind] !== undefined,
  );
  if (kinds.length !== 1) {
    reasons.push(`${path}: not exactly one of skill, step and event`);
    return;
  }
  const [kind] = kinds;
  checkNonEmptyString(trigger[kind], `${path}.${kind}`, reasons);
  checkTrueFlag(trigger.clearsPlan, `${path}.clearsPlan`, reasons);
  checkTrueFlag(trigger.planFromArgs, `${path}.planFromArgs`, reasons);
  if (kind === 'step' && trigger.clearsPlan !== undefined) {
    reasons.push(`${path}.clearsPlan: a step trigger takes no clearsPlan`);
  }
  if (kind !== 'skill' && trigger.planFromArgs !== undefined) {
    reasons.push(`${path}.planFromArgs: only a skill trigger takes it`);
  }
  checkFrom(trigger.from, `${path}.from`, names, reasons);
  checkPredicates(trigger.when, `${path}.when`, reasons);
}

function checkFrom(
  from: unknown,
  path: string,
  names: WorkflowNames,
  reasons: string[],
): void {
  if (from === undefined) {
    return;
  }
  if (!isStringArray(from)) {
    reasons.push(`${path}: not an array of stage ids and group names`);
    return;
  }
  for (const name of from) {
    if (!names.stageIds.has(name) && !names.groups.has(name)) {
      reasons.push(`${path}: ${name} is neither a stage nor a group`);
    }
  }
}

function checkPredicates(predicates: unknown, path: string, reasons: string[]) {
  if (predicates === undefined) {
    return;
  }
  if (!Array.isArray(predicates)) {
    reasons.push(`${path}: not an array of predicates`);
    return;
  }
  predicates.forEach((predicate, index) => {
    const isNamed =
      typeof predicate === 'string' && PREDICATE_NAMES.includes(predicate);
    const isCounterRose =
      isJsonObject(predicate) &&
      Object.keys(predicate).length === 1 &&
      typeof predicate.counterRose === 'string' &&
      predicate.counterRose !== '';
    if (!isNamed && !isCounterRose) {
      reasons.push(`${path}[${index}]: not a predicate`);
    }
  });
}

// Every claimed skill sits in exactly one stage's `skill` trigger, which takes
// no `from` and no `when`, so a claim always enters that stage.
function checkClaims(
  claims: unknown,
  stages: readonly unknown[],
  path: string,
  reasons: string[],
): void {
  if (!isStringArray(claims)) {
    reasons.push(`${path}.claims: not an array of skill names`);
    return;
  }
  claims.forEach((skill, index) => {
    const triggers = skillTriggers(stages, skill, path);
    if (triggers.length !== 1) {
      reasons.push(
        `${path}.claims[${index}]: ${skill} is in ${triggers.length} skill triggers, not one`,
      );
      return;
    }
    const [{ trigger, triggerPath }] = triggers;
    if (trigger.from !== undefined || trigger.when !== undefined) {
      reasons.push(
        `${triggerPath}: the claimed skill ${skill} takes no from and no when`,
      );
    }
  });
}

function skillTriggers(
  stages: readonly unknown[],
  skill: string,
  path: string,
): { trigger: JsonObject; triggerPath: string }[] {
  const found: { trigger: JsonObject; triggerPath: string }[] = [];
  stages.forEach((stage, stageIndex) => {
    if (!isJsonObject(stage) || !Array.isArray(stage.enter)) {
      return;
    }
    stage.enter.forEach((trigger, index) => {
      if (isJsonObject(trigger) && trigger.skill === skill) {
        found.push({
          trigger,
          triggerPath: `${path}.stages[${stageIndex}].enter[${index}]`,
        });
      }
    });
  });
  return found;
}

// Every variable is one § Templates lists; `{plan}` only in an action's text.
function checkTemplate(
  template: string,
  path: string,
  isActionText: boolean,
  reasons: string[],
): void {
  for (const name of templateVariables(template)) {
    if (!isTemplateVariable(name)) {
      reasons.push(`${path}: {${name}} is not a template variable`);
    } else if (name === 'plan' && !isActionText) {
      reasons.push(`${path}: {plan} is only for an action's text`);
    }
  }
}

function checkNonEmptyString(value: unknown, path: string, reasons: string[]) {
  if (typeof value !== 'string' || value === '') {
    reasons.push(`${path}: not a non-empty string`);
  }
}

function checkTrueFlag(value: unknown, path: string, reasons: string[]) {
  if (value !== undefined && value !== true) {
    reasons.push(`${path}: not true`);
  }
}
