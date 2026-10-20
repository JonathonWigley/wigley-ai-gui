import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { qualify } from '../../shared/plugin-manifests';
import { formsManifest } from './manifest';

export type FormsCommandName = keyof typeof formsManifest.commands;
export type FormsScopeName = keyof typeof formsManifest.scopes & string;

// A forms command's qualified id; a short name the manifest does not declare
// fails to compile.
export function formsCommand(short: FormsCommandName): CommandId {
  return qualify(formsManifest.id, short);
}

// A forms scope's qualified name, as page binds and key hints name it.
export function formsScope(short: FormsScopeName): ViewScope {
  return qualify(formsManifest.id, short);
}

// A forms command's qualified id by its short name; null when the manifest
// declares no command of that name.
export function formsCommandNamed(short: string): CommandId | null {
  return Object.hasOwn(formsManifest.commands, short)
    ? formsCommand(short as FormsCommandName)
    : null;
}

// The numbered command picking choice `n` or jumping to question `n`; null
// past the ninth, which has none.
export function numberedCommand(
  prefix: 'choose' | 'jumpTo',
  n: number,
): CommandId | null {
  return formsCommandNamed(`${prefix}${n}`);
}
