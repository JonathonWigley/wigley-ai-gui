// The `planFormat` section of `auri.json`: each knob's type checked to
// docs/features/feature-contributions/design.md § Section: planFormat. The
// reader of plans applies the defaults.

import type { PlanFormat } from '../../../contracts/contributions';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import type { FeatureReader } from '../../contributions/contract';

const STRING_KNOBS = ['folder', 'file', 'tasksSection', 'titleSuffix'] as const;

// Each reason starts with the knob's path: `.groupHeading.pattern: …`.
export const planFormatReader: FeatureReader<PlanFormat> = {
  label: 'Plan format',
  read(input) {
    const section = input;
    if (!isJsonObject(section)) {
      return { ok: false, reasons: ['not an object'] };
    }
    const reasons: string[] = [];
    for (const knob of STRING_KNOBS) {
      checkOptionalString(section[knob], `.${knob}`, reasons);
    }
    checkGroupHeading(section.groupHeading, reasons);
    checkCounters(section.counters, reasons);
    checkTaskDocs(section.taskDocs, reasons);
    checkVerificationTask(section.verificationTask, reasons);
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    // Every check above passed, so each knob holds the declared shape.
    return { ok: true, value: input as PlanFormat };
  },
};

function checkGroupHeading(groupHeading: unknown, reasons: string[]): void {
  const heading = optionalObject(groupHeading, '.groupHeading', reasons);
  if (heading === null) {
    return;
  }
  checkString(heading.title, '.groupHeading.title', reasons);
  if (typeof heading.pattern !== 'string') {
    reasons.push('.groupHeading.pattern: not a string');
    return;
  }
  try {
    new RegExp(heading.pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reasons.push(`.groupHeading.pattern: does not compile: ${message}`);
  }
}

function checkCounters(counters: unknown, reasons: string[]): void {
  const byName = optionalObject(counters, '.counters', reasons);
  for (const [name, counter] of Object.entries(byName ?? {})) {
    const path = `.counters.${name}`;
    if (!isJsonObject(counter)) {
      reasons.push(`${path}: not an object`);
      continue;
    }
    checkOptionalString(counter.section, `${path}.section`, reasons);
    checkString(counter.heading, `${path}.heading`, reasons);
    checkString(counter.itemPrefix, `${path}.itemPrefix`, reasons);
  }
}

function checkTaskDocs(taskDocs: unknown, reasons: string[]): void {
  const docs = optionalObject(taskDocs, '.taskDocs', reasons);
  if (docs === null) {
    return;
  }
  if (docs.link !== 'bareMd') {
    reasons.push('.taskDocs.link: not bareMd');
  }
  checkString(docs.statusField, '.taskDocs.statusField', reasons);
  const hasLineCount =
    typeof docs.statusLines === 'number' &&
    Number.isInteger(docs.statusLines) &&
    docs.statusLines > 0;
  if (!hasLineCount) {
    reasons.push('.taskDocs.statusLines: not a positive whole number');
  }
  if (!isStringArray(docs.statuses)) {
    reasons.push('.taskDocs.statuses: not an array of strings');
  }
  checkString(docs.running, '.taskDocs.running', reasons);
}

function checkVerificationTask(task: unknown, reasons: string[]): void {
  const verification = optionalObject(task, '.verificationTask', reasons);
  if (verification !== null) {
    checkString(
      verification.lastTaskDocLacking,
      '.verificationTask.lastTaskDocLacking',
      reasons,
    );
  }
}

// The knob as an object; null when it is left out or refused.
function optionalObject(
  value: unknown,
  path: string,
  reasons: string[],
): JsonObject | null {
  if (value === undefined) {
    return null;
  }
  if (!isJsonObject(value)) {
    reasons.push(`${path}: not an object`);
    return null;
  }
  return value;
}

function checkString(value: unknown, path: string, reasons: string[]): void {
  if (typeof value !== 'string') {
    reasons.push(`${path}: not a string`);
  }
}

function checkOptionalString(value: unknown, path: string, reasons: string[]) {
  if (value !== undefined) {
    checkString(value, path, reasons);
  }
}
