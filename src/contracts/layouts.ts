// One layout in a plugin's layouts folder. `revision` grows on every change in
// the layout's folder and never resets, so a URL holding it loads fresh
// modules; `builtIn` marks the `default` layout, which has no files in the
// plugin's data folder.
export interface LayoutEntry {
  name: string;
  revision: number;
  hasCss: boolean;
  builtIn: boolean;
}

// Every layout in a plugin's layouts folder, `default` first. `changed` names
// the layout whose folder change this set announces, null for a set read
// rather than announced.
export interface LayoutSet {
  layouts: LayoutEntry[];
  changed: string | null;
}
