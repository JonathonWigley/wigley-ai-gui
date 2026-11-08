// The session-stash layout contract: what a layout in `layouts/session-stash/<name>/layout.js` draws the stash dialog
// with. The Dialog primitive (scrim, panel and its `Stash session` title) stays the app's; `noteDialog` draws the
// dialog's body each time the dialog opens and again whenever the layouts change. The app sets
// `data-layout-owner="session-stash"` and `data-layout="<name>"` on the element the part returns, `<name>` being the
// layout that drew it, so `[data-layout-owner="session-stash"][data-layout="<name>"] …` in a layout's CSS selects
// only its own parts.
//
// The app keeps the note box, its text and focus, and the keys: Enter stashes and Esc cancels, in scope
// `session-stash.note`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The dialog's body. `session` names the session being stashed as its side-bar row shows it; `hint` says what the
// note is for and what an empty box does.
export interface NoteDialogInput {
  session: string;
  hint: string;
}

export interface NoteDialogKit extends BaseKit {
  // The InputFrame holding the app's note box; appended first when left out. A second call throws
  // `noteBox placed twice`, so the part draws with `default`.
  noteBox(parent: HTMLElement): HTMLElement;
}

// What a part returns: its root, appended to `parent`.
export interface SessionStashPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `session-stash.layout` setting and `default`; a
// part that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  noteDialog?(
    parent: HTMLElement,
    input: NoteDialogInput,
    kit: NoteDialogKit,
  ): SessionStashPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
