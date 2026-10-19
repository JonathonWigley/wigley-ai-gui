import type { CommandId } from './commands';

export type EditorMode = 'normal' | 'insert';

// Keys are vim notation; `<Leader>` stands for EditorKeymap.leader.
export interface EditorRemap {
  mode: EditorMode;
  keys: string;
  to: string;
}

// A normal-mode bind that runs a command in the editor it fired in.
export interface EditorBind {
  keys: string;
  command: CommandId;
}

export interface EditorKeymap {
  leader: string;
  remaps: EditorRemap[];
  binds: EditorBind[];
}

// The scope a page key fires in; `any` fires in every scope. A plugin's scopes
// reach the keymap qualified as `<pluginId>.<scope>`.
export type ViewScope = string;

// Keys pressed in order while no editor has focus; each is a KeyboardEvent.key
// value. Or a chord, alone in `keys`: `<` + any of `C-` (Control), `A-`
// (Alt/Option), `S-` (Shift), `D-` (Command) in that order, at least one of
// C-, A-, D-, + one lowercase letter or digit + `>`, e.g. `<C-h>`. A chord
// fires on the page and inside an editor, matched on the physical key.
export interface PageBind {
  keys: string[];
  scope: ViewScope;
  command: CommandId;
}

// `accelerator` is an Electron accelerator, e.g. `CommandOrControl+W`.
export interface AcceleratorBind {
  accelerator: string;
  command: CommandId;
}

// A chord caught before the page sees it, for chords no menu item can claim.
// `key` is an Electron Input.key value.
export interface InterceptBind {
  key: string;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  command: CommandId;
}

export interface Keymap {
  // Renderer: inside an editor, and on the page outside every editor.
  editor: EditorKeymap;
  page: PageBind[];
  // Main process: app menu chords, intercepted chords, system-wide chords.
  app: AcceleratorBind[];
  intercept: InterceptBind[];
  global: AcceleratorBind[];
}
