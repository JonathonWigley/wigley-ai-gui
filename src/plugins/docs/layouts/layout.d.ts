// The docs layout contract: the parts a docs layout draws and the kit each part gets. A layout defines only the parts
// it changes; `default` draws every other one.
//
// Every builder appends its root element to `parent` before it places an app part, and returns `{ element }`. A
// builder reaches app state only through its kit. It draws key hints with `kit.keyHint(parent, command, { label,
// className })`, status dots with `kit.statusDot`, rows with `kit.row` and empty states with `kit.emptyState`.
//
// An app part (a kit member that places one of the app's own elements, such as `filterBox` or `body`) is placed at
// most once per draw; a second placement throws, and the part draws with `default`. An app part the builder leaves
// out is appended at the end of the part's root element.
import type {
  BaseKit,
  ButtonVariant,
} from '../../../shared/page/layout-host/kit';

export interface LayoutPart {
  element: HTMLElement;
}

// The kit every docs part gets: BaseKit in the part's own scope, plus these owner-only parts.
export interface DocsKit extends BaseKit {
  // An edge prompt: the KeyEdge primitive holding the command's anchor and a KeyChevron. `start` draws the chevron
  // first, `end` the anchor first. `label` draws after the keys. Returns the edge.
  edge(
    parent: HTMLElement,
    command: string,
    options: { side: 'start' | 'end'; chevron: string; label?: string },
  ): HTMLElement;
  // A Codicon icon named `name`, with `className` added.
  icon(parent: HTMLElement, name: string, className?: string): HTMLElement;
}

// The tree pane, scope `docs.tree`. Each app part mounts once per draw. One the pane leaves out the app appends at
// the end of the pane's element, in the order status, filterBox, line, rows.
export interface TreePaneInput {
  // True in Docs mode's tree, false in a session's Docs tab.
  isMachine: boolean;
}
export interface TreePaneKit extends DocsKit {
  // `div.docs-status`: the app sets its text and hides it while it is empty.
  status(parent: HTMLElement): HTMLElement;
  // `div.docs-filter`: the InputFrame holding the app's filter input; the app shows it while the filter is open.
  filterBox(parent: HTMLElement): HTMLElement;
  // The slot the app draws `treeLine` into.
  line(parent: HTMLElement): HTMLElement;
  // `ol.docs-rows`: the app fills it with `treeRow` parts and scrolls it.
  rows(parent: HTMLElement): HTMLElement;
}

// The line between the filter and the rows: the empty index or no-match line (`empty`), or the muted line above the
// rows while a filter is on (`above`). `hint` names the key that acts on it, with its words.
export interface TreeLineInput {
  placement: 'empty' | 'above';
  text: string;
  hint: { command: 'filter' | 'rescan'; words: string } | null;
}

// One tree row. The app sets `is-selected`, `is-cursor` and the click on the row's root element, and keeps the
// mouse from taking focus there.
export interface TreeRowInput {
  id: string;
  type: 'group' | 'entry';
  title: string;
  depth: number;
  // False on a leaf.
  isExpanded: boolean;
  // A group's status rollup.
  detail: string | null;
  // A leaf's status texts, joined with ' · '.
  mark: string | null;
  // A leaf's last-loaded time, short, with the full date and time as its title.
  time: { text: string; title: string } | null;
  isStarred: boolean;
  // The selected leaf: it ends in the cursor prompt.
  isPrompted: boolean;
}
export interface TreeRowKit extends DocsKit {
  // On a prompted row: places the app's `span.docs-row-actions` (`s star  r rename  d trash`) and returns it. On any
  // other row: places nothing and returns null. A prompted row that leaves it out gets it appended at its end.
  cursorPrompt(parent: HTMLElement): HTMLElement | null;
}

// The doc pane, scope `docs.doc`. The app sets `data-doc` on the element the pane draws into: `none` while no doc is
// open, `open`, or `editing`.
export interface DocPaneKit extends DocsKit {
  // The app's scroller `div.docs-doc`: it holds the doc parts and the editor, scrolls, and takes focus. Appended at
  // the end when left out.
  scroller(parent: HTMLElement): HTMLElement;
}
// The doc pane while no doc is open.
export interface EmptyDocInput {
  text: string;
}
// One load-state chip.
export interface ChipInput {
  harness: 'claude' | 'codex';
  text: string;
  tooltip: string;
  state:
    | 'launch'
    | 'on-demand'
    | 'listed'
    | 'shadowed'
    | 'pending'
    | 'not-loaded'
    | 'none';
}
export interface DocHeaderInput {
  title: string;
  // The path shown with `~` for the home folder.
  path: string;
  fullPath: string;
  // The read-only line's text; null for a doc that may be edited.
  readOnly: string | null;
  // Claude's chip, then Codex's; empty for a file no index entry names.
  chips: ChipInput[];
  // The plugin-source status texts, in chip order.
  statuses: string[];
  // The last-loaded line; null when the doc was never loaded.
  loaded: string | null;
}
export interface DocHeaderKit extends DocsKit {
  // The app's `i edit` anchor; the app hides it while the doc is read-only or the editor is open. Appended at the
  // end when left out.
  editHint(parent: HTMLElement): HTMLElement;
}
// The changed-on-disk banner and the changed-on-disk prompt.
export interface NoticeInput {
  text: string;
}
// The frontmatter, or a detail view's field table.
export interface DocBodyInput {
  fields: [string, string][];
}
export interface DocBodyKit extends DocsKit {
  // The app's rendered body `div.md.docs-body`: the markdown, link clicks, source lines and heading anchors.
  // Appended at the end when left out. The app sets `hidden` on the docBody part's root element while the editor is
  // open, so a layout's CSS does not set `display` on that element.
  body(parent: HTMLElement): HTMLElement;
}
// The editor's frame: the file's name and full path.
export interface EditorFrameInput {
  name: string;
  path: string;
}
export interface EditorFrameKit extends DocsKit {
  // The app's editor host `div.docs-editor`. Appended at the end when left out.
  editor(parent: HTMLElement): HTMLElement;
}

// Dialogs. The Dialog primitive (scrim, panel and title) stays the app's; a part draws the dialog's body.
// The name and path box, scope `docs.box`. `completes`: the box completes a path with Tab.
export interface BoxDialogInput {
  label: string;
  completes: boolean;
}
export interface BoxDialogKit extends DocsKit {
  // The InputFrame holding the app's input; appended first when left out.
  textBox(parent: HTMLElement): HTMLElement;
  // `ol.docs-completion`, which the app fills with `completion` parts; appended last when left out.
  completions(parent: HTMLElement): HTMLElement;
}
// One completion under the path box, scope `docs.box`.
export interface CompletionInput {
  text: string;
}
// The Trash confirmation, scope `docs.confirm`. The dialog's title stays the app's.
export interface ConfirmDialogInput {
  question: string;
}
export interface ConfirmKit extends DocsKit {
  // The dialog's actions row. The app empties it before each draw.
  actions(): HTMLElement;
  // A button whose click answers `pick` and which holds `pick`'s key anchor (`confirmYes` / `confirmNo`).
  answer(
    parent: HTMLElement,
    pick: 'yes' | 'no',
    label: string,
    variant?: ButtonVariant,
  ): HTMLButtonElement;
}

// One row of the docs list picker (the kind, place and load-state lists), scope `docs.picker`. The picker panel, its
// title, its filter and its cursor stay the app's. The picker sets `title`, `is-selected`, `is-cursor` and the click
// on the row's root element, so a `pickerRow` gives `kit.row` no `onClick`.
export interface PickerRowInput {
  // The open list's title, as `New doc by kind`.
  picker: string;
  // The row's line, as the picker filters on it.
  label: string;
}
export interface PickerRowKit extends DocsKit {
  // The app's element for the end of the cursor row, or null on every other row. Pass it as
  // `KitRowOptions.trailing`. A row that leaves it out gets it appended at the end of the row's root element.
  trailing(): HTMLElement | null;
}

export interface Layout {
  treePane?(
    parent: HTMLElement,
    input: TreePaneInput,
    kit: TreePaneKit,
  ): LayoutPart;
  treeLine?(
    parent: HTMLElement,
    input: TreeLineInput,
    kit: DocsKit,
  ): LayoutPart;
  treeRow?(
    parent: HTMLElement,
    input: TreeRowInput,
    kit: TreeRowKit,
  ): LayoutPart;
  docPane?(
    parent: HTMLElement,
    input: Record<string, never>,
    kit: DocPaneKit,
  ): LayoutPart;
  emptyDoc?(
    parent: HTMLElement,
    input: EmptyDocInput,
    kit: DocsKit,
  ): LayoutPart;
  docHeader?(
    parent: HTMLElement,
    input: DocHeaderInput,
    kit: DocHeaderKit,
  ): LayoutPart;
  diskBanner?(
    parent: HTMLElement,
    input: NoticeInput,
    kit: DocsKit,
  ): LayoutPart;
  // Scope `docs.conflict`.
  conflictPrompt?(
    parent: HTMLElement,
    input: NoticeInput,
    kit: DocsKit,
  ): LayoutPart;
  docBody?(
    parent: HTMLElement,
    input: DocBodyInput,
    kit: DocBodyKit,
  ): LayoutPart;
  editorFrame?(
    parent: HTMLElement,
    input: EditorFrameInput,
    kit: EditorFrameKit,
  ): LayoutPart;
  boxDialog?(
    parent: HTMLElement,
    input: BoxDialogInput,
    kit: BoxDialogKit,
  ): LayoutPart;
  completion?(
    parent: HTMLElement,
    input: CompletionInput,
    kit: DocsKit,
  ): LayoutPart;
  confirmDialog?(
    parent: HTMLElement,
    input: ConfirmDialogInput,
    kit: ConfirmKit,
  ): LayoutPart;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): LayoutPart;
}
export type CompleteLayout = Required<Layout>;
