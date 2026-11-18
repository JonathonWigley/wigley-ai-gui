// The name of an owner's built-in layout, drawn when no other is picked or loaded,
// and served from the owner's default folder.
export const DEFAULT_LAYOUT_NAME = 'default';

// The owner of a layouts folder: a plugin id, or 'shell'.
export type LayoutOwner = string;

// One layout in an owner's layouts folder. `styleRevision` grows on a save of
// its `.css` and `revision` on a save of its `.js`, `.mjs` or `.json`; both
// grow on a save of an image or font, on the layout joining or leaving the
// set, and on its folder being renamed, moved or deleted. A `default` counts
// only saves of its `layout.css` and `layout.js`, and both grow on its going
// live or built in. Neither resets, so a stylesheet URL holding
// `styleRevision` loads fresh CSS and a URL holding `revision` loads fresh
// modules. `builtIn` marks the bundled
// `default`, which the page draws from its own bundle; a `default` with
// `builtIn: false` is the live default from the owner's default folder in the
// repo clone.
export interface LayoutEntry {
  name: string;
  revision: number;
  styleRevision: number;
  hasCss: boolean;
  builtIn: boolean;
}

// Every layout in an owner's layouts folder, `default` first.
export interface LayoutSet {
  layouts: LayoutEntry[];
}
