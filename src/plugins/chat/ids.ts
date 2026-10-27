import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { qualify } from '../../shared/plugin-manifests';
import { chatManifest } from './manifest';

export type ChatCommandName = keyof typeof chatManifest.commands;
export type ChatScopeName = keyof typeof chatManifest.scopes & string;

// A chat command's qualified id; a short name the manifest does not declare
// fails to compile.
export function chatCommand(short: ChatCommandName): CommandId {
  return qualify(chatManifest.id, short);
}

// A chat scope's qualified name, as page binds and key hints name it.
export function chatScope(short: ChatScopeName): ViewScope {
  return qualify(chatManifest.id, short);
}

// A chat command's qualified id by its short name; null when the manifest
// declares no command of that name.
export function chatCommandNamed(short: string): CommandId | null {
  return Object.hasOwn(chatManifest.commands, short)
    ? chatCommand(short as ChatCommandName)
    : null;
}
