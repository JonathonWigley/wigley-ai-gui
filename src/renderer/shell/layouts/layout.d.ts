import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The shell chrome's layout contract: what the core puts in the title bar and the activity bar, and each toast. The
// app keeps the areas and their arrangement, the side bar's contents and state, every plugin's contribution, the click
// that shows a mode, and the shown mode's mark (`is-shown`, `aria-current`) on its activity item. For a toast it keeps
// the toasts layer, `data-tone` and `role="status"` on the toast's root, the fade in, the 4000 ms it shows for and its
// removal.

// The same members as `ToastTone` in the app's plugin contract, which this file cannot import;
// `toast-tone.test-d.ts` checks the two stay equal.
export type ToastTone = 'success' | 'info' | 'error';
export interface ToastInput {
  text: string;
  tone: ToastTone;
}

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
// qualified id (as `docs.openDoc`), and a hint anchors in every scope. A hint shows once the plugins have started.
// `keys` and `command` read the commands the app serves, so `command` runs a command of either process.
export interface ShellKit extends BaseKit {
  // `div.ui-floating`: the glass panel, appended to `parent`. The app's toast fade keys on it.
  floatingPanel(parent: HTMLElement): HTMLElement;
}

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
  // A toast's whole look, drawn once per toast into the toasts layer. A shown toast keeps the layout it drew with; a
  // layout change applies from the next toast.
  toast?(parent: HTMLElement, input: ToastInput, kit: ShellKit): HTMLElement;
}

// The built-in `default` layout, which defines every part.
export interface CompleteLayout extends Required<Layout> {}
