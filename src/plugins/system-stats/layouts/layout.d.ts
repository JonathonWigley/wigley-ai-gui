// The system-stats layout contract: what a layout in `layouts/system-stats/<name>/layout.js` draws the right-bar panel
// with. While the panel is shown, the app draws one `panel` into its right-bar slot. The app sets
// `data-layout-owner="system-stats"` and `data-layout="<name>"` on the element the part returns, `<name>` being the
// layout that drew it, so `[data-layout-owner="system-stats"][data-layout="<name>"] …` in a layout's CSS selects only
// its own part.
//
// The app keeps:
// - the right-bar slot, contributed while the panel is shown and removed while it is hidden (`Space v y`);
// - the keys and the focus: Alt+l past main's right edge gives the panel the keys, `j`/`k`/`gg`/`G` walk a cursor over
//   the rows, `s` sorts by the next column, Enter or `l` opens the cursor's group and `h` closes it; the layout adds
//   `is-cursor` to the row whose `isCursor` is true, and the app scrolls the first `.is-cursor` into view;
// - the cursor, the sort and the open groups;
// - every redraw: on each snapshot, each settings change, each layouts set, each key and each focus change.
import type { BaseKit, MeterTone } from '../../../shared/page/layout-host/kit';

// One meter row. `value` is the value text: `38%`, `21.4 / 32 GB`, `1.2 MB/s ↓ 80 KB/s ↑`, or `—`.
export interface StatsMeterInput {
  label: 'CPU' | 'GPU' | 'RAM' | 'Network' | 'Disk';
  percent: number | null; // 0–100; null when unreadable: draw the meter at 0
  tone: MeterTone;
  history: readonly number[]; // 0–100, oldest first; for kit.sparkline
  value: string;
  note: string | null; // RAM's memory note (`default` shows it as the row's tooltip); null on every other meter
}

// One process-list row: a group (an app or a Chat session's process tree), a process, or the Other row, which holds
// the CPU no process row does and never opens. `cpu`, `ram` and `gpu` are the column texts: `22.5%`, `700 MB` or
// `1.8 GB`, and `6.0%`; `—` with no reading, as on the Other row's RAM and GPU.
export interface StatsRowInput {
  id: string;
  name: string;
  kind: 'app' | 'session' | 'process' | 'other';
  depth: 0 | 1; // 1: a process inside an open group
  isOpen: boolean; // true on an open group; false on a closed group, on every process and on the Other row
  cpu: string;
  ram: string;
  gpu: string;
  isCursor: boolean;
}

// The whole panel. The rows come sorted by `sort`, each open group followed by its processes.
export interface PanelInput {
  reading: boolean; // true until the first snapshot; meters and rows are empty then
  error: string | null;
  meters: StatsMeterInput[]; // CPU, GPU, RAM, Network, Disk, in that order
  sort: 'cpu' | 'ram' | 'gpu';
  rows: StatsRowInput[];
  moreRows: number; // top-level rows cut by the processRows setting
}

// The kit the panel gets.
export interface SystemStatsKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface SystemStatsPart {
  element: HTMLElement;
}

// The part comes from the first layout that defines it among the `system-stats.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  panel?(
    parent: HTMLElement,
    input: PanelInput,
    kit: SystemStatsKit,
  ): SystemStatsPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
