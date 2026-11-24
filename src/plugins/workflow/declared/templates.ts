// A declared workflow's templates: strings with `{variable}` slots filled from
// the flow (docs/features/feature-contributions/design.md § Templates).

import {
  checklistCount,
  detailLine,
  type PlanProgress,
  type SessionFlow,
} from '../contract';

const VARIABLE = /\{([^{}]*)\}/g;

const PLAN_COUNTER_PREFIX = 'plan.counter.';
const COUNTER_PREFIX = 'counter.';

const NAMED_VARIABLES: ReadonlySet<string> = new Set([
  'plan',
  'plan.title',
  'plan.checked',
  'plan.total',
  'plan.build',
  'plan.wave',
  'checklist',
]);

// The variables `template` names, in order, each as written between braces.
export function templateVariables(template: string): string[] {
  return [...template.matchAll(VARIABLE)].map((match) => match[1]);
}

// Whether `name` is a variable § Templates lists.
export function isTemplateVariable(name: string): boolean {
  return (
    NAMED_VARIABLES.has(name) ||
    planCounterOf(name) !== null ||
    counterOf(name) !== null
  );
}

// The plan counter a `{plan.counter.<name>}` variable names, else null.
export function planCounterOf(name: string): string | null {
  return namePart(name, PLAN_COUNTER_PREFIX);
}

// `template` with each variable filled from `flow`. Every `{plan.…}` variable
// is empty while the plan is unread, `{plan}` while it has no folder, and
// `{checklist}` with no items; a `0/0` count is empty. A template whose every
// variable is empty or 0 renders `''`; one with no variable renders as written.
export function renderTemplate(template: string, flow: SessionFlow): string {
  const names = templateVariables(template);
  const values = new Map(
    names.map((name) => [name, variableValue(name, flow)]),
  );
  const isAllEmpty =
    names.length > 0 &&
    [...values.values()].every((value) => value === '' || value === 0);
  if (isAllEmpty) {
    return '';
  }
  return template.replace(VARIABLE, (_slot, name: string) =>
    String(values.get(name) ?? ''),
  );
}

// The detail parts rendered and joined as `detailLine` joins them, each part
// that renders `''` left out.
export function renderDetail(
  parts: readonly string[] | undefined,
  flow: SessionFlow,
): string {
  return detailLine(...(parts ?? []).map((part) => renderTemplate(part, flow)));
}

// `<checked>/<total>` over every box but the verification task; null with no
// such box.
export function buildCount(progress: PlanProgress): string | null {
  const built = progress.tasks.filter((task) => !task.verification);
  return built.length === 0
    ? null
    : `${built.filter((task) => task.done).length}/${built.length}`;
}

function variableValue(name: string, flow: SessionFlow): string | number {
  if (name === 'checklist') {
    return checklistCount(flow) ?? '';
  }
  if (name === 'plan') {
    return flow.plan?.dir ?? '';
  }
  const counter = counterOf(name);
  if (counter !== null) {
    return flow.counters[counter] ?? 0;
  }
  const progress = flow.plan?.progress ?? null;
  return progress === null ? '' : planValue(name, progress);
}

// The reader refuses a variable § Templates does not list, so the default
// branch reads only as empty.
function planValue(name: string, progress: PlanProgress): string | number {
  const planCounter = planCounterOf(name);
  if (planCounter !== null) {
    return progress.counters[planCounter] ?? 0;
  }
  switch (name) {
    case 'plan.title':
      return progress.title;
    case 'plan.checked':
      return progress.checked;
    case 'plan.total':
      return progress.total;
    case 'plan.build':
      return buildCount(progress) ?? '';
    case 'plan.wave':
      return progress.wave ?? '';
    default:
      return '';
  }
}

function counterOf(name: string): string | null {
  return namePart(name, COUNTER_PREFIX);
}

// What follows `prefix` in `name`; null when `name` does not start with it or
// names nothing after it.
function namePart(name: string, prefix: string): string | null {
  return name.startsWith(prefix) && name.length > prefix.length
    ? name.slice(prefix.length)
    : null;
}
