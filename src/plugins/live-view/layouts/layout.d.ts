// The live-view layout contract: what a layout in `layouts/live-view/<name>/layout.js` draws a session's Live section
// with. In the session hub's Live section, the app draws one `liveView` while the session's agent shows Live, and
// nothing otherwise, which hides the section. The app sets `data-layout-owner="live-view"` and `data-layout="<name>"`
// on the element the part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="live-view"][data-layout="<name>"] …` in a layout's CSS selects only its own part.
//
// The app keeps:
// - the section's frame, its title, its summary (what streams) and its collapse, which are chat's;
// - the `<video>`: the app puts its own into the `videoSlot` the part returns, sizes it to the frame's shape and crops
//   it to the Game View; a layout never touches it;
// - when the stream runs: only while the `videoSlot` is on screen and the window is shown;
// - no keys and no focus: the part takes neither.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The line above the video, or null when there is none: the Game View moved, the editor window closed, the stream
// failed to start, or Screen Recording is off. `action`, when set, is a button's label and the qualified id of the
// command it runs.
export interface LiveViewInput {
  readonly notice: {
    readonly text: string;
    readonly action: {
      readonly label: string;
      readonly command: string;
    } | null;
  } | null;
}

// What a part returns: its root, appended to `parent`, and the element inside it the app puts the video into.
export interface LiveViewPart {
  readonly element: HTMLElement;
  readonly videoSlot: HTMLElement;
}

// Each part comes from the first layout that defines it among the `live-view.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, appends other nodes beside it, or returns no `videoSlot` inside
// its element is drawn by `default` instead.
export interface Layout {
  liveView?(
    parent: HTMLElement,
    input: LiveViewInput,
    kit: BaseKit,
  ): LiveViewPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
