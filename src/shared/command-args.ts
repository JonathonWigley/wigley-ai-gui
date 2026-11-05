import type { CommandArgShape, CommandId } from '../contracts/commands';
import { isJsonObject } from './json';

function isKind(value: unknown, kind: 'number' | 'string'): boolean {
  return kind === 'number'
    ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === 'string';
}

// What is wrong with `arg` as a run of `id`, whose declared argument is `shape`,
// or null when it fits. A record reports one problem: missing or mistyped fields
// first, in the shape's field order, then extra fields in the arg's order.
export function checkCommandArg(
  id: CommandId,
  shape: CommandArgShape | undefined,
  arg: unknown,
): string | null {
  if (shape === undefined) {
    return arg === undefined ? null : `command "${id}" takes no argument`;
  }
  if (shape === 'number' || shape === 'string') {
    return isKind(arg, shape) ? null : `command "${id}" needs a ${shape}`;
  }
  if (!isJsonObject(arg)) {
    return `command "${id}" needs a record`;
  }
  for (const [field, kind] of Object.entries(shape)) {
    if (!Object.hasOwn(arg, field) || !isKind(arg[field], kind)) {
      return `command "${id}" needs "${field}" as a ${kind}`;
    }
  }
  const extra = Object.keys(arg).find((field) => !Object.hasOwn(shape, field));
  return extra === undefined
    ? null
    : `command "${id}" takes no field "${extra}"`;
}

// `id` with no arg, else `id` + one space + the arg as JSON: `forms.choose 3`. A
// record's fields print sorted by name, so one record gives one target.
export function commandTarget(id: CommandId, arg: unknown): string {
  if (arg === undefined) {
    return id;
  }
  const printed = isJsonObject(arg)
    ? Object.fromEntries(
        Object.entries(arg).sort(([a], [b]) => (a < b ? -1 : 1)),
      )
    : arg;
  return `${id} ${JSON.stringify(printed)}`;
}
