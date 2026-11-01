import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The sessions layout contract: what a layout in `layouts/sessions/<name>/layout.js` draws Sessions mode's side bar
// and tab bar with. A layout defines only the parts it changes; every part it leaves out, and every part that throws,
// returns no element appended to `parent`, or appends any other node to `parent`, is drawn by `default` instead. The
// app sets `data-layout-owner="sessions"` and `data-layout="<name>"` on the element each part returns, `<name>` being
// the layout that drew it, so `[data-layout-owner="sessions"][data-layout="<name>"] …` in a layout's CSS selects only
// its own parts.
//
// Panes. `sideBar` draws once per layout set, and `tabBar` once per session per layout set. The app fills the side
// bar's `rows` with one `row` per session and each tab bar's `strip` with one `tab` per tab of its session, replacing
// their children on each draw. A pane whose `rows` or `strip` is not a child of its `element` is drawn by `default`
// instead.
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
// - the `title` tooltip on each row (`label`, or `label · status`) and each tab (`title`), and each tab's `aria-label`
//   (`title`), so a tab that draws only its icon keeps its accessible name;
// - `is-no-target` on the elements `sessionEdge`, `prevTabEdge`, `nextTabEdge` and `closeHint` return, which hides
//   each while it has nothing to act on, and on the key inside each of `splitRightHint`, `splitDownHint` and
//   `closePaneHint`; every tab bar's prompts and those keys take `is-no-target` outside the focused pane, since the
//   keys act on the focused pane only;
// - whether the empty text shows: `emptyText` draws only while the tab area shows no tab.
// The tab bodies, the sheet that holds them and the tab elements other plugins add stay the app's.
// Every key prompt here has no scope, so it shows in every scope; a layout that leaves a kit prompt out leaves that
// key unprompted.

// One session row. `harness` is the harness's name, '' for none; `marked` is true while a round waits unopened;
// `status` is the second line, null for none; `onScreen` is true while the session shows in a pane other than the
// focused one.
export interface SessionRowInput {
  sessionId: string;
  label: string;
  harness: string;
  marked: boolean;
  status: string | null;
  onScreen: boolean;
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

// A part's root, appended to `parent`.
export interface SessionsPart {
  element: HTMLElement;
}

// `rows` is the list the app fills with the session rows; a child of `element`.
export interface SideBarPane extends SessionsPart {
  rows: HTMLElement;
}

// `strip` is the strip the app fills with its session's tabs; a child of `element`.
export interface TabBarPane extends SessionsPart {
  strip: HTMLElement;
}

// `body` is the box the app fills with the pane's session or empty text; a child of `element`.
export interface PanePart extends SessionsPart {
  body: HTMLElement;
}

export interface SessionsKit extends BaseKit {}

export interface PaneKit extends SessionsKit {
  // `‹ ⌥H ⌃⌥H swap` on a pane's left edge, and the same toward each other `direction`: the keys that focus the pane
  // that way and swap with it, the chevron toward it.
  focusEdge(parent: HTMLElement, direction: PaneDirection): HTMLElement;
}

export interface SideBarKit extends SessionsKit {
  // `⌥⇧I ▲ ▼ ⌥⇧O`: the previous and next session prompts, each chevron on its inner side.
  sessionEdge(parent: HTMLElement): HTMLElement;
}

export interface TabBarKit extends SessionsKit {
  // `⌥I ‹`: the previous tab prompt.
  prevTabEdge(parent: HTMLElement): HTMLElement;
  // `› ⌥O`: the next tab prompt.
  nextTabEdge(parent: HTMLElement): HTMLElement;
  // `⌘W close`: the close prompt.
  closeHint(parent: HTMLElement): HTMLElement;
  // The `split-horizontal` button holding `⌥;`, which splits the pane with the new pane right.
  splitRightHint(parent: HTMLElement): HTMLElement;
  // The `split-vertical` button holding `⌥'`, which splits the pane with the new pane below.
  splitDownHint(parent: HTMLElement): HTMLElement;
  // The `close` button holding `⌥W`, which closes the pane.
  closePaneHint(parent: HTMLElement): HTMLElement;
}

export interface EmptyTextKit extends SessionsKit {
  // The key that picks the next session, `span.sessions-pick-hint`; the app makes it once, so each draw moves it. A
  // second call throws `pickHint placed twice`, so the part draws with `default`.
  pickHint(parent: HTMLElement): HTMLElement;
}

export interface Layout {
  // The side bar: a header over the session rows.
  sideBar?(parent: HTMLElement, kit: SideBarKit): SideBarPane;
  row?(
    parent: HTMLElement,
    input: SessionRowInput,
    kit: SessionsKit,
  ): SessionsPart;
  // One chat pane's frame around its body.
  pane?(parent: HTMLElement, input: PaneInput, kit: PaneKit): PanePart;
  // The bar over a session's tabs: the tab strip between its prompts, then the pane controls.
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
}

// A layout with every part defined, as `default` is.
export interface CompleteLayout extends Required<Layout> {}
