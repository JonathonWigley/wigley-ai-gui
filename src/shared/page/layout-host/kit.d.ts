// The kit types every owner's layout contract shares. The app writes this file to `layouts/kit.d.ts`, beside each
// owner's `layout.d.ts`, which imports it as `'../kit'`.

// The tones a kit tag takes and the variants a kit button takes.
export type TagTone =
  | 'neutral'
  | 'accent'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface KitButtonOptions {
  variant?: ButtonVariant;
  keys?: string | null;
}

// The states a status dot shows.
export type DotStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';

// `className` is added to the hint's span; `label` draws the command's label after the keys, or the given text in
// its place.
export interface KeyHintOptions {
  className?: string;
  label?: boolean | string;
}

// A list or tree row: leading, label, detail and trailing on one line. `depth` indents a tree row; `onClick` makes
// the row clickable.
export interface KitRowOptions {
  density: 'list' | 'tree';
  label: string;
  detail?: string | null;
  leading?: HTMLElement | null;
  trailing?: HTMLElement | null;
  depth?: number;
  tag?: 'div' | 'li';
  onClick?: () => void;
}

// An edge prompt's side: `start` draws `<chevron> <keys> <label>`, `end` draws `<keys> <label> <chevron>`. `chevron`
// is `‹` at the start and `›` at the end when left out.
export interface KitEdgeOptions {
  side: 'start' | 'end';
  chevron?: string;
  label?: string;
}

// Every part appends itself to `parent` and returns what it appended, except where its comment says otherwise.
export interface BaseKit {
  el(
    parent: HTMLElement,
    tag: string,
    className?: string,
    text?: string,
  ): HTMLElement;
  markdown(parent: HTMLElement, text: string, className?: string): HTMLElement;
  inlineMarkdown(
    parent: HTMLElement,
    text: string,
    className?: string,
  ): HTMLElement;
  // `section.context`: a section header over the text as markdown; nothing and null for blank text.
  section(parent: HTMLElement, label: string, text: string): HTMLElement | null;
  // The keys bound to the owner's command (its short name, as `choose1`), or to a name holding a `.` read as a
  // qualified id (as `panes.focusLeft`), in the scope of the part drawing, as `keysFor` reads it; null when unbound or
  // for a name no command has. It reads the keymap once, when called, so text a part draws from
  // it keeps the keys of the part's build after a rebind; draw a hint with `keyHint` for one that follows the keymap.
  keys(command: string): string | null;
  // `span` (with `options.className`): an anchor for the owner's command `command` in the scope of the part drawing;
  // a name holding a `.` names any plugin's command by its qualified id (as `panes.focusLeft`). It shows while that
  // scope is in force and the hints setting is on, and follows keymap changes. `options.label` draws the command's
  // label after the keys, or the given text. Empty while unbound, for a short name no command of the owner has, or for
  // a qualified id no plugin registers.
  keyHint(
    parent: HTMLElement,
    command: string,
    options?: KeyHintOptions,
  ): HTMLElement;
  // A runner for any plugin's command by its qualified id (as `docs.openDoc`): each call runs the command, and getting
  // it runs nothing. It checks the id when called, so call it while the part builds: an id no plugin registers throws
  // `no command <id>`, and the part falls back to `default` like any that throws.
  command(qualifiedId: string): () => void;
  // The keys bound to any plugin's command by its qualified id, in the scope of the part drawing; null when unbound.
  // `keys` and `keyHint` read the same scope. It reads the keymap once, when called, as `keys` does.
  keysFor(qualifiedId: string): string | null;
  // `div.ui-card` with `className` added.
  card(parent: HTMLElement, className?: string): HTMLElement;
  // `span.ui-tag`; tone `neutral` when left out.
  tag(parent: HTMLElement, text: string, tone?: TagTone): HTMLElement;
  // A key hint for `keys` as `keys(command)` returns it, drawn for the platform.
  kbd(parent: HTMLElement, keys: string): HTMLElement;
  // `button.ui-button`, variant `secondary` when left out; never takes focus. `keys` draws its hint after the label.
  button(
    parent: HTMLElement,
    label: string,
    onClick: () => void,
    options?: KitButtonOptions,
  ): HTMLButtonElement;
  // `h3.ui-section-header`: a sentence-case label over a part of the view.
  sectionHeader(parent: HTMLElement, text: string): HTMLElement;
  // `span.ui-dot` showing `status`.
  statusDot(parent: HTMLElement, status: DotStatus): HTMLElement;
  // Shows `status` on a dot `statusDot` drew; appends nothing.
  setDotStatus(dot: HTMLElement, status: DotStatus): void;
  // `.ui-row`: a list or tree row. The app sets `is-selected` and `is-cursor` on the rows it keeps the cursor on.
  row(parent: HTMLElement, options: KitRowOptions): HTMLElement;
  // `p.ui-empty`: one line saying what to do, then `hint`, the key or action that does it.
  emptyState(
    parent: HTMLElement,
    text: string,
    hint?: HTMLElement | null,
  ): HTMLElement;
  // `span.ui-key-prompt`: a static key hint for `keys`, drawn for the platform, with `label` after it.
  keyPrompt(parent: HTMLElement, keys: string, label?: string): HTMLElement;
  // A Codicon named `name` (`chevron-right` draws `codicon-chevron-right`), with each class of `className` added.
  icon(parent: HTMLElement, name: string, className?: string): HTMLElement;
  // `span.ui-key-chevron` reading `text`, placed beside a key hint; it hides and shows with that hint.
  chevron(parent: HTMLElement, text: string): HTMLElement;
  // `span.ui-key-edge`: a focus move's prompt for `command`, named as `keyHint` names it (the core's
  // `panes.focusLeft` or `panes.focusRight` for a move between panes), its hint and chevron as `options` places them.
  edge(
    parent: HTMLElement,
    command: string,
    options: KitEdgeOptions,
  ): HTMLElement;
  // `span.ui-row-trailing` at the end of `row`, for what the row ends with.
  rowTrailing(row: HTMLElement): HTMLElement;
  // How long `ms` lasts, in whole seconds rounded down: `42s` under a minute, `3m 05s` under an hour, else `1h 02m`;
  // a negative span reads `0s`. Appends nothing.
  duration(ms: number): string;
}
