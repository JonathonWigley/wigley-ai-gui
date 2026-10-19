import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { qualify } from '../../shared/plugin-manifests';
import { formsManifest } from './manifest';

type FormsCommandName = keyof typeof formsManifest.commands;
export type FormsScopeName = (typeof formsManifest.scopes)[number];

// A forms command's qualified id; a short name the manifest does not declare
// fails to compile.
export function formsCommand(short: FormsCommandName): CommandId {
  return qualify(formsManifest.id, short);
}

// A forms scope's qualified name, as page binds and key hints name it.
export function formsScope(short: FormsScopeName): ViewScope {
  return qualify(formsManifest.id, short);
}
