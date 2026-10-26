import type { CommandId } from '../../../contracts/commands';
import type { ViewScope } from '../../../contracts/keymap';
import { qualify } from '../../../shared/plugin-manifests';
import { primerManifest } from '../manifest';

export type PrimerCommandName = keyof typeof primerManifest.commands;
export type PrimerScopeName = keyof typeof primerManifest.scopes & string;

// A primer command's qualified id; a short name the manifest does not declare
// fails to compile.
export function primerCommand(short: PrimerCommandName): CommandId {
  return qualify(primerManifest.id, short);
}

// A primer scope's qualified name, as page binds and key hints name it.
export function primerScope(short: PrimerScopeName): ViewScope {
  return qualify(primerManifest.id, short);
}
