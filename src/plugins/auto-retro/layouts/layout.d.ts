// The auto-retro layout contract: what a layout in `layouts/auto-retro/<name>/layout.js` draws the Retro section's
// header part with. While retros wait to run, the app draws one `queued` part at the end of the Retro
// section's header, and nothing while none waits. The app sets `data-layout-owner="auto-retro"` and
// `data-layout="<name>"` on the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="auto-retro"][data-layout="<name>"] …` in a layout's CSS selects only its own parts.
//
// The app keeps:
// - the Retro section, its label and its rows, which the sessions layout draws;
// - every redraw: on each change of the queued count, each side-bar draw and each layouts set.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The retros still waiting to run, above 0.
export interface QueuedInput {
  queued: number;
}

// The kit every auto-retro part gets.
export interface AutoRetroKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AutoRetroPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `auto-retro.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  queued?(
    parent: HTMLElement,
    input: QueuedInput,
    kit: AutoRetroKit,
  ): AutoRetroPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
