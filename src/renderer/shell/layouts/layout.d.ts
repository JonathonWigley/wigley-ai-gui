import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The shell chrome's layout contract: what the core puts in the title bar and the activity bar. The app keeps the
// areas and their arrangement, the side bar's contents and state, every plugin's contribution, the click that shows a
// mode, and the shown mode's mark (`is-shown`, `aria-current`) on its activity item.

// The shown mode's context: its title, and its detail or null.
export interface ContextInput {
  title: string;
  detail: string | null;
}
export interface ProblemInput {
  file: string;
  message: string;
}
// Never empty when drawn.
export interface ProblemsInput {
  problems: readonly ProblemInput[];
}
// A mode: its id, its title, and its Codicon name.
export interface ActivityItemInput {
  id: string;
  title: string;
  icon: string;
}

// The shell's kit. The shell owns no command, so `keys`, `keyHint` and `edge` take any plugin's command by its
// qualified id (as `docs.openDoc`), and a hint anchors in every scope. The keys plugin's keys reach the chrome once the
// plugins start: until then a hint draws empty and `keys` and `keysFor` read null, and every part draws again then.
// `command` runs any registered page command.
export interface ShellKit extends BaseKit {}

// A layout defines only the parts it changes: each part comes from the first layout that defines it among the
// `shell.layout` setting's layout and `default`. A part that throws, or returns no element appended to `parent`, is
// drawn by `default` instead. The layout's `layout.css` restyles the chrome frames under
// `[data-layout-owner="shell"][data-layout="<name>"]` on the title bar, activity bar, side bar, right bar and status
// bar elements; the layout does not move the areas. Every part appends its element to `parent` and returns it.
export interface Layout {
  // The title bar's centre: the shown mode's context. Drawn again on each change; not drawn while the mode has none.
  titleContext?(
    parent: HTMLElement,
    input: ContextInput,
    kit: ShellKit,
  ): HTMLElement;
  // At the title bar's start, in the dev app only.
  devTag?(parent: HTMLElement, kit: ShellKit): HTMLElement;
  // At the title bar's end while a config file is broken. Drawn again on each change.
  configProblems?(
    parent: HTMLElement,
    input: ProblemsInput,
    kit: ShellKit,
  ): HTMLElement;
  // One per mode in the activity bar. The app shows the mode on a click and marks the shown mode's item.
  activityItem?(
    parent: HTMLElement,
    input: ActivityItemInput,
    kit: ShellKit,
  ): HTMLElement;
}

// The built-in `default` layout, which defines every part.
export interface CompleteLayout extends Required<Layout> {}
