import type { CommandArg, CommandId } from './commands';
import type { ProcessName } from './plugin';

export type EditorMode = 'normal' | 'insert';

// Keys are vim notation; `<Leader>` stands for EditorKeymap.leader.
export interface EditorRemap {
  mode: EditorMode;
  keys: string;
  to: string;
}

// A bind that runs a command in the editor it fired in, while `scope` is in
// force; `any` fires in every scope. It fires in `mode`, normal when absent.
// An insert-mode bind's keys are one key the host can type unbound, today
// only `<CR>`, and in a scope it has no bind the key does what it does unbound
// (Enter breaks the line).
export interface EditorBind {
  keys: string;
  scope: ViewScope;
  command: CommandId;
  mode?: EditorMode;
  arg?: CommandArg;
}

export interface EditorKeymap {
  leader: string;
  remaps: EditorRemap[];
  binds: EditorBind[];
}

// The scope a page or editor key fires in; `any` fires in every scope. A
// plugin's scopes reach the keymap qualified as `<pluginId>.<scope>`.
export type ViewScope = string;

// Which keys a hint reads: the page's, or those inside a text box.
export type HintWhere = 'page' | 'box';

export interface AnchorOptions {
  // The qualified scope the hint shows in; left out, the hint shows in every scope.
  // The keys come from the first bind of `command` in this scope (`any` binds included) whose keys
  // are not vim's own keys; when every bind is a vim key, from the first bind.
  scope?: ViewScope;
  // 'page' (default) reads page binds; 'box' reads binds inside a text box.
  where?: HintWhere;
  // Draws the command's label after the keys (cursor prompts, edge prompts with words).
  // A string draws that text in place of the command's label.
  label?: boolean | string;
  // The argument the anchored bind carries: the keys of that argument's bind, and a
  // placement of that argument alone. Left out, the command's first bind is drawn.
  arg?: CommandArg;
}

// The keys of an unfinished sequence with the scope they were typed in: on the
// page, as KeyboardEvent.key values (`[' ', 'a']`); in an editor, as vim names
// them (`['<Space>', 'a']`).
export type PendingKeys =
  | { where: 'page'; keys: string[]; scope: ViewScope }
  | { where: 'editor'; keys: string[]; scope: ViewScope };

// Keys pressed in order while no editor has focus; each is a KeyboardEvent.key
// value. Or a chord, alone in `keys`, written by `CHORD_NOTATION_RULE` in
// `src/shared/chord-notation.ts` (`<C-h>`, `<D-Enter>`), firing on the page and
// inside an editor and matching the typed character.
export interface PageBind {
  keys: string[];
  scope: ViewScope;
  command: CommandId;
  arg?: CommandArg;
}

// `accelerator` is an Electron accelerator, e.g. `CommandOrControl+W`.
export interface AcceleratorBind {
  accelerator: string;
  command: CommandId;
  arg?: CommandArg;
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
  arg?: CommandArg;
}

// Which side of a text box's edge a bind fires on: `page` while no editor has
// focus, `box` inside one, `both` on either.
export type BindWhere = 'page' | 'box' | 'both';

// One bind as the default keymap, a plugin manifest and the user's
// `keymap.json` write it, in vim notation (`<Leader>ks`, `gg`, `<A-o>`,
// `<Esc>`). With no `where`, a bind whose first token is `<Leader>` fires on
// the page and in a box, and any other bind fires on the page; a chord on the
// page fires inside a box too. `where` overrides that (a chord takes only
// `page`), and a bind with `mode` fires only in a box, in that vim mode. The
// merge expands each into the `PageBind` and `EditorBind` it stands for. `arg` is
// what the command runs with, and no part of which bind a key holds: two binds on
// one key that differ only by `arg` are a key bound twice.
export interface KeyBind {
  keys: string;
  scope: ViewScope;
  command: CommandId;
  where?: BindWhere;
  mode?: EditorMode;
  arg?: CommandArg;
}

// A bind a part adds while it runs, its scope and command qualified as in
// `keymap.json`. Main's binds take no `global` section.
export type RuntimeBind<P extends ProcessName = ProcessName> = P extends 'page'
  ? KeyBind
  :
      | { kind: 'app'; bind: AcceleratorBind }
      | { kind: 'intercept'; bind: InterceptBind };

// The which-key name of each leader prefix, by its keys (`<Leader>k`).
export type KeyGroups = Record<string, string>;

// The app's default keys, each bind written once as a `KeyBind`; `leader` is
// the vim token `<Leader>` stands for on the page and in a box.
export interface DefaultKeymap {
  leader: string;
  groups: KeyGroups;
  binds: KeyBind[];
  remaps: EditorRemap[];
  app: AcceleratorBind[];
  intercept: InterceptBind[];
  global: AcceleratorBind[];
}

export interface Keymap {
  // Renderer: inside an editor, and on the page outside every editor.
  editor: EditorKeymap;
  page: PageBind[];
  // Main process: app menu chords, intercepted chords, system-wide chords.
  app: AcceleratorBind[];
  intercept: InterceptBind[];
  global: AcceleratorBind[];
  // Which-key names of leader prefixes, keys written with `<Leader>`.
  groups: KeyGroups;
}

// A default bind the user's keymap removes. A `keys` entry is expanded as a
// `KeyBind` is, and removes each page and editor bind it stands for: a page
// bind by its keys and scope, an editor bind by its keys, scope and mode
// (normal when absent). An app or global entry names its accelerator; an
// intercept entry its key and modifiers (each absent one false).
export type KeymapUnbind =
  | { keys: string; scope: ViewScope; where?: BindWhere; mode?: EditorMode }
  | { app: string }
  | { global: string }
  | { intercept: Omit<InterceptBind, 'command'> };

// The user's `keymap.json`, in the default keymap's shape and laid over it and
// the plugins' keys: each bind names its command and scope qualified
// (`forms.nextItem`, `forms.review`, `any`). `leader` replaces the default
// leader on the page and in a box; `groups` names replace the same prefix's.
export interface UserKeymap {
  leader?: string;
  groups?: KeyGroups;
  binds?: KeyBind[];
  remaps?: EditorRemap[];
  app?: AcceleratorBind[];
  intercept?: InterceptBind[];
  global?: AcceleratorBind[];
  unbind?: KeymapUnbind[];
}
