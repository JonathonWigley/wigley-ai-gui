// The layout a plugin's page builds with. `revision` grows on every change to
// a layout's files and every switch, so a URL holding it loads fresh modules;
// `builtIn` marks the `default` layout, which has no files in the plugin's
// data folder.
export interface LayoutChoice {
  name: string;
  revision: number;
  hasCss: boolean;
  builtIn: boolean;
  reason: 'start' | 'cycled' | 'reloaded' | 'copied';
}
