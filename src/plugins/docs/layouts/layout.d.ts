// The docs layout contract: the parts a docs layout draws and the kit each part gets. A layout defines only the parts
// it changes; `default` draws every other one.
//
// Every builder appends its root element to `parent` before it places an app part, and returns `{ element }`. A
// builder reaches app state only through its kit. It draws key hints with `kit.keyHint(parent, command, { label,
// className })`, status dots with `kit.statusDot`, rows with `kit.row` and empty states with `kit.emptyState`.
//
// An app part (a kit member that places one of the app's own elements, such as `filterBox` or `body`) is placed at
// most once per draw; a second placement throws, and the part draws with `default`. An app part the builder leaves
// out is appended at the end of the part's root element, unless its comment places it elsewhere.
import type {
  BaseKit,
  ButtonVariant,
} from '../../../shared/page/layout-host/kit';

export interface LayoutPart {
  element: HTMLElement;
}

// The kit every docs part gets: BaseKit in the part's own scope.
export interface DocsKit extends BaseKit {}

// The tree pane, scope `docs.tree`. Each app part mounts once per draw. One the pane leaves out the app appends at
// the end of the pane's element, in the order sidebarSwitch, status, filterBox, line, rows.
export interface TreePaneInput {
  // True in Docs mode's tree, false in a session's Docs tab.
  isMachine: boolean;
}
export interface TreePaneKit extends DocsKit {
  // `div.docs-switch-slot`: the slot the app draws `sidebarSwitch` into. The app sets `hidden` on it in a session's
  // Docs tab, which has no switch.
  sidebarSwitch(parent: HTMLElement): HTMLElement;
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
  // `wikiLink` is a link in the wiki's `Main.md` that opens no doc as a leaf does, `wikiLabel` a heading in that list.
  type: 'group' | 'entry' | 'wikiLink' | 'wikiLabel';
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
  // A `wikiLink` whose target the index does not hold; false on every other row.
  isDangling: boolean;
  // The size of a `wikiLink`'s kind or owner list; null on every other row.
  count: number | null;
}
export interface TreeRowKit extends DocsKit {
  // On a prompted row: places the app's `span.docs-row-actions` (`s star  r rename  d trash`; the wiki view leaves out
  // `s star`) and returns it. On any other row: places nothing and returns null. A prompted row that leaves it out
  // gets it appended at its end.
  cursorPrompt(parent: HTMLElement): HTMLElement | null;
}

// The doc pane, scope `docs.doc`. The app sets `data-doc` on the element the pane draws into: `none` while no doc is
// open, `open`, `editing`, or `page` while a page with no file shows: a list page or the empty Main page.
export interface DocPaneKit extends DocsKit {
  // The app's scroller `div.docs-doc`: it holds the doc parts and the editor, scrolls, and takes focus. Its size
  // containment gives it no height from its content, so its parent gives it a definite height. Appended at the end
  // when left out.
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
  // The app's `e section` anchor; the app hides it while it hides `editHint` and while the doc has no heading.
  // Appended at the end when left out.
  sectionHint(parent: HTMLElement): HTMLElement;
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
  // Appended at the end when left out. The app sets `hidden` on the docBody part's root element while the whole-file
  // editor is open, so a layout's CSS does not set `display` on that element. While a section edits, that root stays
  // shown, the section's blocks hide, and the app places the editor's frame and the banner and prompt slots inside
  // the body, where those blocks sat.
  body(parent: HTMLElement): HTMLElement;
}
// The editor's frame: the file's name and full path as the editor opened. The editor never moves while open, so a
// file moved meanwhile keeps the frame's name and path until the editor closes and the next edit draws it again.
export interface EditorFrameInput {
  name: string;
  path: string;
}
export interface EditorFrameKit extends DocsKit {
  // The app's editor host `div.docs-editor`, with `is-section` while a section edits, when the frame's slot sits
  // inside the rendered body. Appended at the end when left out.
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

// pageFrame, scope docs.doc. Input: Record<string, never>.
export interface PageFrameKit extends DocsKit {
  // The app's `div.docs-article`: the header, banner, prompt, body, Recent changes, page and editor slots. Appended
  // first when left out.
  article(parent: HTMLElement): HTMLElement;
  // The app's `div.docs-aside`. The app sets `hidden` on it while it holds nothing, so a layout's CSS does not set
  // `display` on it. Appended last when left out.
  aside(parent: HTMLElement): HTMLElement;
}
// pageAside, scope docs.doc. Input: Record<string, never>.
export interface PageAsideKit extends DocsKit {
  // The app's `div.docs-aside-section` for On this page. The app fills it with one `asideHeading` and an `asideLink`
  // per heading, and sets `hidden` on it while the doc has no heading. Appended first when left out.
  onThisPage(parent: HTMLElement): HTMLElement;
  // The same for Linked from, hidden while no doc links here. Appended last when left out.
  linkedFrom(parent: HTMLElement): HTMLElement;
}
// asideHeading, scope docs.doc. `kind: 'sections'` is the heading of what `Ctrl+h` and `Ctrl+l` move through.
export interface AsideHeadingInput {
  title: string;
  kind: 'sections' | 'linkedFrom';
}
// asideLink, scope docs.doc. The app sets the click and the `title` (the tooltip) on the root, and keeps the mouse
// from taking focus there, so an `asideLink` gives `kit.row` no `onClick`. The app sets the section's `title` on an
// On this page row, and the `~` path on a Linked from row. `depth` indents a heading under its parent.
export interface AsideLinkInput {
  title: string;
  depth: number;
}
// sectionEditControl, scope docs.doc: drawn inside a rendered heading.
export interface SectionEditControlInput {
  // The section's heading text.
  title: string;
}
export interface SectionEditControlKit extends DocsKit {
  // Opens this section in the editor.
  openSection(): void;
}
// recentChanges, scope docs.doc.
export interface RecentChangesInput {
  rows: {
    sha: string;
    subject: string;
    time: { text: string; title: string };
    pages: { title: string; path: string }[];
  }[];
}
export interface RecentChangesKit extends DocsKit {
  // Appends the app's link to the page at `path` to `parent` and returns it.
  pageLink(parent: HTMLElement, title: string, path: string): HTMLElement;
}
// listRow, scope docs.doc. The app sets `is-selected`, `is-cursor` and the click on the row's root element.
export interface ListRowInput {
  title: string;
  path: string;
  time: { text: string; title: string } | null;
}
// listPage, scope docs.doc.
export interface ListPageInput {
  title: string;
  count: number;
  groups: { title: string; rows: ListRowInput[] }[];
}
export interface ListPageKit extends DocsKit {
  // The app's `ol.docs-list-rows` for group `groupIndex`, which the app fills with `listRow` parts. One slot per group,
  // each placed at most once per draw. One left out is appended at the end of the part's root, in group order.
  rows(parent: HTMLElement, groupIndex: number): HTMLElement;
}
// sidebarSwitch, scope docs.tree. Its kit is DocsKit. The app sets the click on the root and keeps the mouse from
// taking focus there; a click anywhere on the control switches the view.
export interface SidebarSwitchInput {
  view: 'wiki' | 'all';
}
// mainEmpty, scope docs.doc.
export interface MainEmptyInput {
  // The Main page's path, shown with `~`.
  path: string;
}
export interface MainEmptyKit extends DocsKit {
  // The app's hint that offers to create the Main page. Appended at the end of the part's root when left out.
  createMainHint(parent: HTMLElement): HTMLElement;
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
  pageFrame?(
    parent: HTMLElement,
    input: Record<string, never>,
    kit: PageFrameKit,
  ): LayoutPart;
  pageAside?(
    parent: HTMLElement,
    input: Record<string, never>,
    kit: PageAsideKit,
  ): LayoutPart;
  asideHeading?(
    parent: HTMLElement,
    input: AsideHeadingInput,
    kit: DocsKit,
  ): LayoutPart;
  asideLink?(
    parent: HTMLElement,
    input: AsideLinkInput,
    kit: DocsKit,
  ): LayoutPart;
  sectionEditControl?(
    parent: HTMLElement,
    input: SectionEditControlInput,
    kit: SectionEditControlKit,
  ): LayoutPart;
  recentChanges?(
    parent: HTMLElement,
    input: RecentChangesInput,
    kit: RecentChangesKit,
  ): LayoutPart;
  listPage?(
    parent: HTMLElement,
    input: ListPageInput,
    kit: ListPageKit,
  ): LayoutPart;
  listRow?(parent: HTMLElement, input: ListRowInput, kit: DocsKit): LayoutPart;
  sidebarSwitch?(
    parent: HTMLElement,
    input: SidebarSwitchInput,
    kit: DocsKit,
  ): LayoutPart;
  mainEmpty?(
    parent: HTMLElement,
    input: MainEmptyInput,
    kit: MainEmptyKit,
  ): LayoutPart;
}
export interface CompleteLayout extends Required<Layout> {}
