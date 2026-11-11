// The app-update layout contract: what a layout in `layouts/app-update/<name>/layout.js` draws the title bar's update
// button with. While an update waits, runs or has failed, the app draws one `button` into its slot at the title bar's
// end, before the Keys button; with nothing to install the slot leaves the title bar and takes no room. The app sets
// `data-layout-owner="app-update"` and `data-layout="<name>"` on the element the part returns, `<name>` being the
// layout that drew it, so `[data-layout-owner="app-update"][data-layout="<name>"] …` in a layout's CSS selects only
// its own part.
//
// The app keeps the slot, the checks and the install. A click runs `app-update.install` (`kit.button` or
// `kit.command`), which installs only from `available` or `failed`, so a click while `installing` does nothing; the
// app redraws the part on each status change, settings change and layouts set.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// `available`: origin's main holds commits the installed app was not built from, `sha` the short commit; `installing`:
// `npm run install-app` runs, and quits and restarts the app when it is done; `failed`: the install ended with an error
// and the app still runs, `error` the last lines of its log. `sha` is null and `error` null outside their state.
export interface ButtonInput {
  state: 'available' | 'installing' | 'failed';
  sha: string | null;
  error: string | null;
}

// The kit the button gets.
export interface AppUpdateKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AppUpdatePart {
  element: HTMLElement;
}

// The part comes from the first layout that defines it among the `app-update.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  button?(
    parent: HTMLElement,
    input: ButtonInput,
    kit: AppUpdateKit,
  ): AppUpdatePart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
