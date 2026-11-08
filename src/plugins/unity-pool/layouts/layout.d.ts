// The unity-pool layout contract: what a layout in `layouts/unity-pool/<name>/layout.js` draws the pool with. Under
// each session row, in the row part's wrapper, the app draws one `rowBadge` per pool the session holds a clone of or
// waits in, and nothing when there are none. In the right bar, while the shown session is in a pool, the app draws
// one `panel` for that pool. The app sets `data-layout-owner="unity-pool"` and `data-layout="<name>"` on the element
// each part returns, `<name>` being the layout that drew it, so `[data-layout-owner="unity-pool"][data-layout="<name>"]
// …` in a layout's CSS selects only its own parts.
//
// The app keeps:
// - the row part and the right-bar slot, contributed while the shown session has a pool and removed when it has none;
// - the clicks: a holder's `select` selects its row, and an action's `run` runs `unity-pool hold|release` through
//   main, the clone's `action.running` true until the result lands in its `result`;
// - the keys and the focus: Alt+l past main's right edge gives the panel the keys, `j`/`k`/`gg`/`G` walk a cursor
//   over the session holders and Enter shows the cursor's session, as the holder's click does; the buttons and
//   links never take focus;
// - every redraw: on each pool change, each change of the shown session or its rows, each action result, and once a
//   minute for the times.
// Durations arrive in milliseconds; `kit.duration` formats them: `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One badge under a session row: "Unity 3" while the row's session holds clone 3 (a claim or an open /clear
// handoff), "Unity: queued 2nd" while it waits second in a queue.
export interface RowBadgeInput {
  text: string;
  queued: boolean;
}

// Who holds a clone. `kind` 'session' is a session with a side-bar row, whose click `select` selects that row;
// 'user' is a hold the user made; 'agent' is a session the app has no row for. `idleMs` is the time since the
// claim's last renewal, null for a hold, a handoff or a stranded mark. `isCursor` is true on the one session holder
// the keyboard cursor is on while the panel holds the keys; the layout adds `is-cursor` to that holder's element,
// and the app scrolls the first `.is-cursor` in the panel into view.
export interface HolderInput {
  kind: 'session' | 'user' | 'agent';
  label: string;
  idleMs: number | null;
  select: (() => void) | null;
  isCursor: boolean;
}

// One clone of the pool. `branch` reads `detached` on a detached HEAD and `unknown` for a clone never probed;
// `editor` is the editor's state in words (`editor ready`, `in Play Mode`). `blocking` is true only while the queue
// has a long wait, on each clone that keeps the queue waiting: held, handed off, stranded or dirty. `action` is Hold
// on a free clone and Release on the user's hold, null otherwise; `result` is the last Hold or Release's outcome.
export interface PanelCloneInput {
  title: string;
  path: string;
  branch: string;
  dirty: boolean;
  editor: string;
  holder: HolderInput | null;
  handoffMs: number | null;
  stranded: { reason: string; forMs: number } | null;
  warmup: { state: 'running' | 'failed'; error: string | null } | null;
  blocking: boolean;
  action: {
    label: 'Hold' | 'Release';
    run: () => void;
    running: boolean;
  } | null;
  result: { ok: boolean; text: string } | null;
}

// One queue ticket, in queue order: `position` is `1st`, `2nd` …
export interface PanelQueueInput {
  position: string;
  holder: HolderInput;
  branch: string;
  waitedMs: number;
  longWait: boolean;
}

// The whole panel for pool `pool`: its clones by number, its queue, whether any ticket waits long, and the counts
// the page logs.
export interface PanelInput {
  pool: string;
  clones: PanelCloneInput[];
  queue: PanelQueueInput[];
  longWait: boolean;
  counts: { held: number; free: number; queued: number; blocking: number };
}

// The kit every unity-pool part gets.
export interface UnityPoolKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface UnityPoolPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `unity-pool.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  rowBadge?(
    parent: HTMLElement,
    input: RowBadgeInput,
    kit: UnityPoolKit,
  ): UnityPoolPart;
  panel?(
    parent: HTMLElement,
    input: PanelInput,
    kit: UnityPoolKit,
  ): UnityPoolPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
