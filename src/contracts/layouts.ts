// The owner of a layouts folder: a plugin id, or 'shell'.
export type LayoutOwner = string;

// One layout in an owner's layouts folder. `styleRevision` grows on every
// change of the layout's style files and never resets, so the stylesheet URL
// holding it loads fresh CSS; `revision` grows on every other change and never
// resets, so a URL holding it loads fresh modules. `builtIn` marks the bundled
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
