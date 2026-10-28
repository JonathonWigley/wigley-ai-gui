// The keys layout contract: the parts a keys layout draws for the help overlay, the which-key panel and the title
// bar's Keys button, and the kit each part gets. The app keeps the help dialog (its title, scrim and Close button),
// the which-key panel's placement and timers, the Keys button's slot in the title bar, and every key and scope.
//
// Keys reach a part already printed for the platform: draw them with `kit.kbd(parent, keys)`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

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
// One key that continues a pending sequence.
export interface WhichKeyEntryInput {
  keys: string;
  label: string;
  kind: 'command' | 'prefix';
}
export interface WhichKeyInput {
  title: string;
  entries: readonly WhichKeyEntryInput[];
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
// which-key panel's contents, and `titleBarButton` the Keys button in its title bar slot.
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
  titleBarButton?(parent: HTMLElement, kit: KeysKit): HTMLElement;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
