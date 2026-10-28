import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The sessions layout contract: what a layout in `layouts/sessions/<name>/layout.js` draws Sessions mode's side bar
// and tab bar with. A layout defines only the parts it changes; every part it leaves out, and every part that throws,
// returns no element appended to `parent`, or appends any other node to `parent`, is drawn by `default` instead. The
// app sets `data-layout-owner="sessions"` and `data-layout="<name>"` on the element each part returns, `<name>` being
// the layout that drew it, so `[data-layout-owner="sessions"][data-layout="<name>"] …` in a layout's CSS selects only
// its own parts.
//
// Panes. `sideBar` and `tabBar` draw once per layout set. The app fills the pane's `rows` with one `row` per session
// and its `strip` with one `tab` per tab of the selected session, replacing their children on each draw. A pane
// whose `rows` or `strip` is not a child of its `element` is drawn by `default` instead.
//
// The app keeps:
// - the click on each row (activate its session) and each tab (select it), set on the element the part returns with
//   `ui-row--action` and a mousedown that takes no focus, and dropped while that element is `is-disabled`;
// - `is-selected` and `aria-current="true"` on the selected row, `is-active` and `aria-current` on the active tab;
// - the `title` tooltip on each row (`label`, or `label · status`) and each tab (`title`);
// - `is-no-target` on the elements `sessionEdge`, `prevTabEdge`, `nextTabEdge` and `closeHint` return, which hides
//   each while it has nothing to act on;
// - whether the empty text shows: `emptyText` draws only while the tab area shows no tab.
// The tab bodies, the sheet that holds them and the tab elements other plugins add stay the app's.
// Every key prompt here has no scope, so it shows in every scope; a layout that leaves a kit prompt out leaves that
// key unprompted.

// One session row. `harness` is the harness's name, '' for none; `marked` is true while a round waits unopened;
// `status` is the second line, null for none.
export interface SessionRowInput {
  sessionId: string;
  label: string;
  harness: string;
  marked: boolean;
  status: string | null;
}

// One tab of the selected session.
export interface SessionTabInput {
  title: string;
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

// `strip` is the strip the app fills with the selected session's tabs; a child of `element`.
export interface TabBarPane extends SessionsPart {
  strip: HTMLElement;
}

export interface SessionsKit extends BaseKit {}

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
  // The bar over the tab area: the tab strip between its prompts.
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
