// The owner of a layouts folder: a plugin id, or 'shell'.
export type LayoutOwner = string;

// One layout in an owner's layouts folder. `revision` grows on every change in
// the layout's folder and never resets, so a URL holding it loads fresh
// modules. `builtIn` marks the bundled `default`, which the page draws from
// its own bundle; a `default` with `builtIn: false` is the live default from
// the owner's default folder in the repo clone.
export interface LayoutEntry {
  name: string;
  revision: number;
  hasCss: boolean;
  builtIn: boolean;
}

// Every layout in an owner's layouts folder, `default` first. `changed` names
// the layout whose folder change this set announces, null for a set read
// rather than announced.
export interface LayoutSet {
  layouts: LayoutEntry[];
  changed: string | null;
}
