// The terminal layout contract: what a layout in `layouts/terminal/<name>/layout.js` draws a session's terminal drawer
// with. The app draws one `drawerHeader` above each session's terminal screen, while that session's drawer is open. The
// app sets `data-layout-owner="terminal"` and `data-layout="<name>"` on the element the header returns, `<name>` being
// the layout that drew it, so `[data-layout-owner="terminal"][data-layout="<name>"] …` in a layout's CSS selects only
// its own header.
//
// The app keeps:
// - the terminal screen under the header, which the emulator draws;
// - the keys and the focus: the screen takes every key but the app's chords and Esc;
// - the drawer's frame and its height, which are sessions'.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One session's shell. `folder` is the shell's folder as `paths.tilde` shows it; `exitReason` is how the shell
// ended (`code 0`, `signal 1`, or the host's error) while `state` is `exited`, else null.
export interface DrawerHeaderInput {
  sessionId: string;
  folder: string;
  state: 'starting' | 'running' | 'exited';
  exitReason: string | null;
}

// What a part returns: its root, appended to `parent`.
export interface TerminalPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `terminal.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  drawerHeader?(
    parent: HTMLElement,
    input: DrawerHeaderInput,
    kit: BaseKit,
  ): TerminalPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
