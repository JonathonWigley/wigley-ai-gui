import type { TextEditor } from '../contracts/editor';
import type { CommandRegistry } from '../shared/command-registry';
import type { BoxRef } from './forms/boxes';

// `editor` is the editor a bind fired in and `box` the forms text box that
// editor edits; a page key fires outside every editor and carries neither.
export interface RendererCommandContext {
  editor?: TextEditor;
  box?: BoxRef;
}

export type RendererCommands = CommandRegistry<RendererCommandContext>;
