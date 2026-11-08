import type { BaseKit, DotStatus } from '../../../shared/page/layout-host/kit';

// The sessions layout contract: what a layout in `layouts/sessions/<name>/layout.js` draws Sessions mode's side bar,
// its chat panes, each session's tab bar and each session's popups with. A layout defines only the parts it changes; every part it leaves out, and every part that throws,
// returns no element appended to `parent`, or appends any other node to `parent`, is drawn by `default` instead. The
// app sets `data-layout-owner="sessions"` and `data-layout="<name>"` on the element each part returns, `<name>` being
// the layout that drew it, so `[data-layout-owner="sessions"][data-layout="<name>"] …` in a layout's CSS selects only
// its own parts.
//
// Panes. `sideBar` draws once per layout set, and `tabBar` once per session per layout set and again whenever another
// plugin adds or removes a bar part. The app fills the side bar's `rows` with the `section`s: Favorites, Recent, then
// each section another plugin registers that claims a row, by its order. Favorites and Recent always draw. The app fills
// a Favorites or Recent `section`'s `groups` with one `group` per project and a `group`'s `rows` with that project's
// `row`s; a plugin section's `groups` holds its `row`s directly, with no `group`, and is no drop zone. It fills each tab
// bar's `strip` with one `tab` per tab of its session, replacing their children on each draw. A `row` places other plugins'
// row parts and a `tabBar` their bar parts, each through its kit's `contributedParts`. A part whose `rows`, `groups`,
// `header` or `strip` is not a child of its `element` is drawn by `default` instead.
//
// Chat panes. Sessions mode splits into panes, each showing one session. `pane` draws each pane's frame, again
// whenever its input changes; the app fills its `body` with the session's tab bar over its tabs, or with the empty
// text, and the pane tree draws the focused pane's border. A `pane` whose `body` is not a child of its `element` is
// drawn by `default` instead.
//
// The app keeps:
// - the click on each row (activate its session) and each tab (select it), set on the element the part returns with
//   `ui-row--action` and a mousedown that takes no focus, and dropped while that element is `is-disabled`;
// - `is-selected` and `aria-current="true"` on the selected row, `is-active` and `aria-current` on the active tab;
// - the `title` tooltip on each row (`title · label · activity · each row part's tooltip`, each only when present) and
//   each tab (`title`),
//   and each tab's `aria-label` (`title`), so a tab that draws only its icon keeps its accessible name;
// - `is-no-target` on the elements `sessionEdge`, `prevTabEdge`, `nextTabEdge` and `closeHint` return, which hides
//   each while it has nothing to act on, and on the key inside each of `splitRightHint`, `splitDownHint` and
//   `closePaneHint`; every tab bar's prompts and those keys take `is-no-target` outside the focused pane, since the
//   keys act on the focused pane only;
// - whether the empty text shows: `emptyText` draws only while the tab area shows no tab;
// - the click on the star `favoriteToggle` places, which favorites or unfavorites the group's project;
// - the `title` tooltip (`project`) on each group's `header` and the drag on it, the whole header being the drag source;
// - `is-empty` on the element of a `section` with no groups;
// - the plugin's own content in the header part `headerPart` places, which its plugin draws;
// - `has-favorites` on the side bar's `rows` while Favorites holds a group, and `is-reordering` there while a group is
//   dragged;
// - `is-open` on the root of the popup that shows, the top open popup of its session, and `inert` on every other
//   popup's root; `is-entering` on a popup's root from its add until its first transition on that root ends or the
//   popup hides, so a slide up on add keyed on it runs once; the click on each `popupBar` entry, which opens its popup,
//   set as on a tab, and the entry's `aria-label` (its popup's `title`).
// The tab bodies, the sheet that holds them, the popup layer over them and the elements other plugins add stay the
// app's.
// Every key prompt here has no scope, so it shows in every scope; a layout that leaves a kit prompt out leaves that
// key unprompted.
//
// Popups. A session's popup slides up over its tabs while a plugin has something for the user. `popup` draws each
// popup's frame once when the popup is added and again on each layout set; the app fills its `body` with the plugin's
// element. `popupBar` draws the bar at the bottom of a session's frame while the session holds a hidden popup, again on
// each change to its popups, with one entry per hidden popup, newest hidden first. A `popup` whose `body`, or a
// `popupBar` whose entries, are not children of its `element` are drawn by `default` instead, and so is a `popupBar`
// returning another count of entries than its input holds.
//
// Dialogs. The Dialog primitive (scrim, panel and title) stays the app's; a part draws the dialog's body.
// `renameDialog` draws the rename dialog's body each time the dialog opens and again whenever its input or the layouts
// change.

// One session row. `title` is the session's title as the row shows it (the user's, else the agent's, else the first
// message cut to the title length), null for none, which `default` draws as `New Chat`; `section` is the id of the
// plugin section that claimed the row, null for a row in a project group, and `default` draws a claimed row muted with a
// dashed accent edge; `label` is the session's folder label (`gamma 2`); `harness` is
// the harness's name, '' for none; `marked` is true while something marked the row waits unviewed, and never on the selected row; `activity` is what the session is
// doing, its word, its tone and its emphasis, null for none; `default` draws the word as a label, a Tag for attention, warning and
// error or any emphasis, solid for `urgent`, gives a row with an emphasis a status edge in its tone,
// and draws a needs you label for `marked` only while no activity is set; the contributed parts fill the row's second line, where `default` puts the parts ordered 2 and later on a third line of their own; `onScreen` is true while the session shows in a pane other than
// the focused one.
export interface SessionRowInput {
  sessionId: string;
  title: string | null;
  label: string;
  harness: string;
  marked: boolean;
  activity: {
    word: string;
    tone: DotStatus;
    emphasis: 'raised' | 'urgent' | null;
  } | null;
  onScreen: boolean;
  section: string | null;
}

// One side bar section: Favorites and Recent always draw, then each plugin section that claims a row. `kind` is
// `plugin` for a section another plugin registered; `id` is the kind for Favorites and Recent, the registration's id for
// a plugin section; `label` is its name (`Favorites`, `Recent`, the registration's label); `dropHint` says what dropping
// a group into it does, shown while it is empty and a group is dragged, '' for a plugin section; `isEmpty` is true
// while it holds no groups, and never for a plugin section.
export interface SectionInput {
  kind: 'favorites' | 'recent' | 'plugin';
  id: string;
  label: string;
  dropHint: string;
  isEmpty: boolean;
}

// One project's group. `project` is its name; `count` is how many rows it holds; `isFavorite` is true for a favorite
// project.
export interface GroupInput {
  project: string;
  count: number;
  isFavorite: boolean;
}

// A way out of a pane, as the core's pane keys name it.
export type PaneDirection = 'left' | 'right' | 'up' | 'down';

// One chat pane. `isFocused` is true for the focused pane while two panes or more show; `edges` lists the directions
// in which the focused pane has a neighbour, and is empty on every other pane.
export interface PaneInput {
  isFocused: boolean;
  edges: PaneDirection[];
}

// One tab of a session. `icon` is a Codicon name.
export interface SessionTabInput {
  title: string;
  icon: string;
}

// Why the tab area shows no tab. `hasHint` is true when the text asks for a session to be picked; `kit.pickHint`
// then draws the key that picks the next one.
export interface EmptyTextInput {
  text: string;
  hasHint: boolean;
}

// One session popup. `title` is what the popup is (a form's round, the primer); `icon` is a Codicon name.
export interface PopupInput {
  title: string;
  icon: string;
}

// The bar listing a session's hidden popups, newest hidden first. Each entry's `status` is the popup's status, '' for
// none, which `default` draws as its `title` instead.
export interface PopupBarInput {
  entries: { title: string; icon: string; status: string }[];
}

// The rename dialog's body, scope `sessions.rename`. `problem` is why the typed title was refused, null for none;
// `hint` says what an empty box does.
export interface RenameDialogInput {
  problem: string | null;
  hint: string;
}

// A part's root, appended to `parent`.
export interface SessionsPart {
  element: HTMLElement;
}

// `rows` is the box the app fills with the `section`s: Favorites, Recent, then each plugin section that claims a row, by
// its order; a child of `element`.
export interface SideBarPane extends SessionsPart {
  rows: HTMLElement;
}

// `groups` is the box the app fills with one `group` per project, and a drop zone while a group is dragged; a plugin
// section's `groups` holds its `row`s directly, with no `group`, and is no drop zone. A child of `element`.
export interface SectionPane extends SessionsPart {
  groups: HTMLElement;
}

// `header` is the group's drag source; `rows` is the box the app fills with the project's `row`s. Each a child of
// `element`.
export interface GroupPane extends SessionsPart {
  header: HTMLElement;
  rows: HTMLElement;
}

// `strip` is the strip the app fills with its session's tabs; a child of `element`. A strip that should scroll its tabs
// in a narrow bar carries `ui-tabs ui-tabs--scroll`, as the default layout's does.
export interface TabBarPane extends SessionsPart {
  strip: HTMLElement;
}

// `body` is the box the app fills with the pane's session or empty text; a child of `element`.
// What `pane` returns: its root, appended to `parent`, its body, and an optional `update` the app runs with the pane's
// new input in place of drawing the pane again, so the click of a release that focuses the pane reaches what it landed
// on. Without `update`, or when it throws (logged), the app draws the pane again and that click is lost.
export interface PanePart extends SessionsPart {
  body: HTMLElement;
  update?(input: PaneInput): void;
}

// `body` is the box the app fills with the plugin's element, which takes `height: 100%`; a child of `element`.
export interface PopupPart extends SessionsPart {
  body: HTMLElement;
}

// `entries` holds one element per input entry, in order, each a child of `element`; the app sets each one's click.
export interface PopupBarPart extends SessionsPart {
  entries: HTMLElement[];
}

export interface SessionsKit extends BaseKit {}

export interface PaneKit extends SessionsKit {
  // `‹ ⌥H ⌃⌥H swap` on a pane's left edge, and the same toward each other `direction`: the keys that focus the pane
  // that way and swap with it, the chevron toward it.
  focusEdge(parent: HTMLElement, direction: PaneDirection): HTMLElement;
}

export interface RowKit extends SessionsKit {
  // `div.session-row-parts`, holding one `div.session-row-part` (`data-part="<id>"`) per part other plugins added
  // for every row, in the order they were added; returns the `div.session-row-parts`. Call it once, where the parts
  // go: a row that leaves it out gets the parts appended at the end of its element. A part that throws is logged and
  // draws nothing. A second call throws `row placed contributed parts twice`, so the row draws with `default`. The
  // holder lays its parts on one line, each part keeping its content's width.
  contributedParts(parent: HTMLElement): HTMLElement;
}

export interface SectionKit extends SessionsKit {
  // `div.session-section-part` (`data-part="<section id>"`) at the end of `parent`, holding the plugin section's header
  // part; returns the div, empty for a section with no header part and for Favorites and Recent. A section that leaves
  // it out draws no header part. A part that throws is logged, and the div returned is empty and outside the tree. A
  // second call throws `headerPart placed twice`, so the section draws with `default`.
  headerPart(parent: HTMLElement): HTMLElement;
}

export interface SideBarKit extends SessionsKit {
  // `⌥⇧I ▲ ▼ ⌥⇧O`: the previous and next session prompts, each chevron on its inner side.
  sessionEdge(parent: HTMLElement): HTMLElement;
}

export interface GroupKit extends SessionsKit {
  // `button.session-group-star`: the star, `star-full` labelled `Unfavorite` with `is-active` on a favorite, else
  // `star-empty` labelled `Favorite`. A group that leaves it out has no star to click. A second call throws
  // `favoriteToggle placed twice`, so the group draws with `default`.
  favoriteToggle(parent: HTMLElement): HTMLElement;
  // `span.session-group-grip` holding the `gripper` icon, a visual cue: the drag belongs to the `header`. A second
  // call throws `dragHandle placed twice`, so the group draws with `default`.
  dragHandle(parent: HTMLElement): HTMLElement;
}

export interface TabBarKit extends SessionsKit {
  // `⌥I ‹`: the previous tab prompt.
  prevTabEdge(parent: HTMLElement): HTMLElement;
  // `› ⌥O`: the next tab prompt.
  nextTabEdge(parent: HTMLElement): HTMLElement;
  // `⌘W`: the close prompt, its key alone.
  closeHint(parent: HTMLElement): HTMLElement;
  // `div.session-bar-parts`, holding one `div.session-bar-part` (`data-part="<id>"`) per part other plugins added
  // for every tab bar, in the order they were added, each drawn for the bar's session; returns the
  // `div.session-bar-parts`. Call it once, where the parts go: a bar that leaves it out gets the parts appended at the
  // end of its element. A part that throws is logged and draws nothing. A second call throws
  // `tabBar placed contributed parts twice`, so the bar draws with `default`.
  contributedParts(parent: HTMLElement): HTMLElement;
  // The `split-horizontal` button holding `⌥;`, which splits the pane with the new pane right.
  splitRightHint(parent: HTMLElement): HTMLElement;
  // The `split-vertical` button holding `⌥'`, which splits the pane with the new pane below.
  splitDownHint(parent: HTMLElement): HTMLElement;
  // The `close` button holding `⌥W`, which closes the pane.
  closePaneHint(parent: HTMLElement): HTMLElement;
}

export interface PopupBarKit extends SessionsKit {
  // The keys of `sessions.togglePopup`, which hides and shows the session's popup. A layout may call it more than once.
  toggleHint(parent: HTMLElement): void;
}

export interface EmptyTextKit extends SessionsKit {
  // The key that picks the next session, `span.sessions-pick-hint`; the app makes it once, so each draw moves it. A
  // second call throws `pickHint placed twice`, so the part draws with `default`.
  pickHint(parent: HTMLElement): HTMLElement;
}

export interface RenameDialogKit extends SessionsKit {
  // The InputFrame holding the app's title box; appended first when left out. A second call throws
  // `textBox placed twice`, so the part draws with `default`.
  textBox(parent: HTMLElement): HTMLElement;
}

export interface Layout {
  // The side bar: a header over the sections.
  sideBar?(parent: HTMLElement, kit: SideBarKit): SideBarPane;
  // One section: its label and drop hint over the box of its groups, or a plugin section's label and header part over
  // the box of its rows.
  section?(
    parent: HTMLElement,
    input: SectionInput,
    kit: SectionKit,
  ): SectionPane;
  // One project's group: its header over the box of its rows.
  group?(parent: HTMLElement, input: GroupInput, kit: GroupKit): GroupPane;
  row?(parent: HTMLElement, input: SessionRowInput, kit: RowKit): SessionsPart;
  // One chat pane's frame around its body.
  pane?(parent: HTMLElement, input: PaneInput, kit: PaneKit): PanePart;
  // The bar over a session's tabs: the tab strip between its prompts, other plugins' bar parts, then the pane
  // controls.
  tabBar?(parent: HTMLElement, kit: TabBarKit): TabBarPane;
  tab?(
    parent: HTMLElement,
    input: SessionTabInput,
    kit: SessionsKit,
  ): SessionsPart;
  // The text saying why the tab area shows no tab.
  emptyText?(
    parent: HTMLElement,
    input: EmptyTextInput,
    kit: EmptyTextKit,
  ): SessionsPart;
  // One session popup's frame around its body.
  popup?(parent: HTMLElement, input: PopupInput, kit: SessionsKit): PopupPart;
  // The bar at a session frame's bottom naming its hidden popups.
  popupBar?(
    parent: HTMLElement,
    input: PopupBarInput,
    kit: PopupBarKit,
  ): PopupBarPart;
  // The rename dialog's body: the title box, why a title was refused, then the hint.
  renameDialog?(
    parent: HTMLElement,
    input: RenameDialogInput,
    kit: RenameDialogKit,
  ): SessionsPart;
}

// A layout with every part defined, as `default` is.
export interface CompleteLayout extends Required<Layout> {}
