// The context-sources layout contract: what a layout in `layouts/context-sources/<name>/layout.js` draws a session's
// context breakdown with. In the session hub's Context section, the app draws one `breakdown` once the session's harness
// has reported where its main agent's context comes from, and nothing before, which hides the section. The app sets
// `data-layout-owner="context-sources"` and `data-layout="<name>"` on the element the breakdown returns, `<name>` being
// the layout that drew it, so `[data-layout-owner="context-sources"][data-layout="<name>"] …` in a layout's CSS selects
// only its own breakdown.
//
// The app keeps:
// - the section's frame, its title, its summary (the total and its share of the window) and its collapse, which are
//   chat's;
// - which sources are open, per session: `toggle` opens or closes one and draws the breakdown again;
// - no keys and no focus: the breakdown takes neither.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One part of a source, its tokens as text (`13k`); a path shows with the home folder as `~`.
export interface ContextItemRow {
  label: string;
  tokens: string;
}

// One source of the context. `share` is its part of what is in context, 0 to 1, and `shareText` that as a whole
// percent (`47%`). `position` counts from 1 in the list's order, largest first, for a layout that colours by place.
// `items` are largest first, empty when the harness names none; `isOpen` is true while the user has it open.
export interface ContextSourceRow {
  id: string;
  label: string;
  tokens: string;
  share: number;
  shareText: string;
  position: number;
  items: readonly ContextItemRow[];
  isOpen: boolean;
}

// How full the context window is: `share` the context's part of the window and `autocompactShare` where compaction
// starts, each 0 to 1, the latter null when the harness reports no limit; `text` reads `128k of 1M` and `autocompactText`
// `compacts at 967k`, null with it.
export interface ContextWindowFill {
  share: number;
  text: string;
  autocompactShare: number | null;
  autocompactText: string | null;
}

// `window` is null when the harness reports no window; `deferred` reads `23k` for what the harness can load and has
// not, null when nothing is deferred. `toggle(id)` opens or closes the source with that id.
export interface BreakdownInput {
  sources: readonly ContextSourceRow[];
  window: ContextWindowFill | null;
  deferred: string | null;
  toggle(id: string): void;
}

// What a part returns: its root, appended to `parent`.
export interface ContextSourcesPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `context-sources.layout` setting and `default`; a
// part that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  breakdown?(
    parent: HTMLElement,
    input: BreakdownInput,
    kit: BaseKit,
  ): ContextSourcesPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
