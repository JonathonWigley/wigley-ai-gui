// The keys layout contract: the parts a keys layout draws for the help overlay, the which-key panel, the leader
// search's rows and the title bar's Keys button, and the kit each part gets. The app keeps the help dialog's scrim,
// keys and focus (its `dialogFrame` draws the panel, title and Close button), the which-key panel's placement and timers, the leader search's list picker (its filter,
// cursor and clicks), the Keys button's slot in the title bar, and every key and scope.
//
// Keys reach a part already printed for the platform: draw them with `kit.kbd(parent, keys)`.
import type {
  BaseKit,
  DialogFrameInput,
  DialogFramePart,
} from '../../../shared/page/layout-host/kit';

// One key in help: its keys as the user reads them, and what it does.
export interface HelpHint {
  keys: string;
  label: string;
}
export interface HelpSectionInput {
  title: string;
  hints: readonly HelpHint[];
}
export interface HelpInput {
  sections: readonly HelpSectionInput[];
}
// One key that continues a pending sequence: a `command` it runs, labelled with the command's label, or a `prefix`
// that leads to more keys, labelled with its group's name (or its commands' groups, joined), with no mark of its own.
export interface WhichKeyEntryInput {
  keys: string;
  label: string;
  kind: 'command' | 'prefix';
}
// `title` is the keys pressed so far, e.g. `Space b`; `name` is the group those keys name, e.g. `session`, null when
// no group names them (the bare leader, an unnamed prefix).
export interface WhichKeyInput {
  title: string;
  name: string | null;
  entries: readonly WhichKeyEntryInput[];
}
// One leader action in the leader search: its command's label, and every key that runs it.
export interface LeaderSearchRowInput {
  label: string;
  keys: string;
}

// The kit every keys part gets. `keyHint` and `keys` name the keys plugin's commands (`toggleHelp`, `closeHelp`).
export interface KeysKit extends BaseKit {
  // `button.ui-icon-button.ui-icon-button--sm` holding the Codicon `icon`, `label` as its tooltip and aria-label;
  // never takes focus.
  iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement;
}
export interface HelpKit extends KeysKit {
  // Draws `section` through the `helpSection` part the layouts pick, appended to `parent`.
  helpSection(parent: HTMLElement, section: HelpSectionInput): HTMLElement;
}
export interface HelpSectionKit extends KeysKit {
  // Draws `hint` through the `helpRow` part the layouts pick, appended to `parent`.
  hint(parent: HTMLElement, hint: HelpHint): HTMLElement;
}
export interface WhichKeyKit extends KeysKit {
  // Draws `entry` through the `whichKeyEntry` part the layouts pick, appended to `parent`.
  entry(parent: HTMLElement, entry: WhichKeyEntryInput): HTMLElement;
}

// Each part comes from the first layout that defines it among the `keys.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// Every part appends one element to `parent` and returns it. `help` draws the help dialog's body, `whichKey` the
// which-key panel's contents, `leaderSearchRow` one row of the leader search's list (the picker sets its `is-cursor`
// class and makes it clickable), and `titleBarButton` the Keys button in its title bar slot.
export interface Layout {
  help?(parent: HTMLElement, input: HelpInput, kit: HelpKit): HTMLElement;
  helpSection?(
    parent: HTMLElement,
    input: HelpSectionInput,
    kit: HelpSectionKit,
  ): HTMLElement;
  helpRow?(parent: HTMLElement, input: HelpHint, kit: KeysKit): HTMLElement;
  whichKey?(
    parent: HTMLElement,
    input: WhichKeyInput,
    kit: WhichKeyKit,
  ): HTMLElement;
  whichKeyEntry?(
    parent: HTMLElement,
    input: WhichKeyEntryInput,
    kit: KeysKit,
  ): HTMLElement;
  leaderSearchRow?(
    parent: HTMLElement,
    input: LeaderSearchRowInput,
    kit: KeysKit,
  ): HTMLElement;
  titleBarButton?(parent: HTMLElement, kit: KeysKit): HTMLElement;
  // The frame of the help overlay: the panel, its title (`input.title`) and, when `input.hasActions`, its actions row.
  // Return the panel, appended to `parent`, with `body` and `actions` inside it; the app fills them. The app keeps the
  // scrim, showing and hiding, keys and focus. A frame whose `body` or `actions` is not inside its panel, or whose
  // `actions` is not null exactly when `hasActions` is false, draws with `default`. Its actions row holds the Close
  // button, `kit.button(actions, 'Close', 'keys.closeHelp')`; a frame that leaves it out has none, and the close key
  // still closes help.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: KeysKit,
  ): DialogFramePart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
