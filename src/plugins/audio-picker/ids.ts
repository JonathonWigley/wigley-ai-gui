import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { qualify } from '../../shared/plugin-manifests';
import { audioPickerManifest } from './manifest';

export type AudioPickerCommandName = keyof typeof audioPickerManifest.commands;
export type AudioPickerScopeName = keyof typeof audioPickerManifest.scopes &
  string;

// An audio picker command's qualified id; a short name the manifest does not
// declare fails to compile.
export function audioPickerCommand(short: AudioPickerCommandName): CommandId {
  return qualify(audioPickerManifest.id, short);
}

// An audio picker scope's qualified name, as page binds and key hints name it.
export function audioPickerScope(short: AudioPickerScopeName): ViewScope {
  return qualify(audioPickerManifest.id, short);
}
