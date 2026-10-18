import type { TextEditor } from '../contracts/editor';
import type { CommandRegistry } from '../shared/command-registry';

// `editor` is the editor a bind fired in; a page key fires outside every editor.
export interface RendererCommandContext {
  editor?: TextEditor;
}

export type RendererCommands = CommandRegistry<RendererCommandContext>;
