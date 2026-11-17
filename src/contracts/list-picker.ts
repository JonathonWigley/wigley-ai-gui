export interface ListPickerRequest<T> {
  // The panel's heading, its accessible name and the name its log line
  // carries.
  title: string;
  items: readonly T[];
  // The line drawn and filtered on.
  label(item: T): string;
  // The row's name when its label also holds a path: a filter's match on it
  // outranks any match on a label.
  name?(item: T): string;
  // The item index highlighted on open; 0 when left out or out of range.
  selected?: number;
  // True keeps the typed filter when `open` replaces a request still open:
  // the new list opens filtered by it, the cursor on `selected` when the
  // filter shows it, else on the best match. Left out, or with the list
  // closed, `open` clears the filter.
  keepFilter?: boolean;
  // Runs once the list has closed on a choice.
  chosen(item: T): void;
  // Runs once the list has closed on `cancel`, or on the pushed scope's base
  // changing under it.
  cancelled?(): void;
  // Drawn at the end of the title line while this request is open.
  headerEnd?: HTMLElement | null;
  // Drawn at the trailing end of the cursor row, on each draw.
  cursorEnd?(item: T): HTMLElement | null;
  // Draws the row for `item` into `parent` (the picker's list) and returns
  // it, appended to `parent`, with the dispose of its draw; the picker draws
  // its built-in row when left out. The picker sets `is-cursor` on the
  // returned row, and a layout styles the cursor row through that class. It
  // appends `trailing` to the row when the row does not hold it, and makes the
  // row clickable as a `.ui-row` with `onClick` is, the click running
  // `picker.chooseRow`. The picker owns a row
  // draw's lifetime: it runs the row's dispose, which may remove the row,
  // before it draws that row again (every row on a filter change or
  // `redraw()`, the old and new cursor rows on a cursor move) and when it
  // closes.
  drawRow?(parent: HTMLElement, item: T, input: DrawRowInput): DrawnPickerRow;
  // The section `item` sits under; null for none. The list draws a heading
  // above a row whose section is not null and differs from the previous row's;
  // it does not sort, so the caller keeps a section's items together. A heading
  // takes no cursor and no click, and hides while a filter is typed.
  section?(item: T): string | null;
  // Draws a heading into `parent`, the heading's `li`, and returns the draw;
  // the title is the `li`'s text when left out. The picker runs its dispose
  // before every row draws again (a filter change or `redraw()`, never a cursor
  // move) and when it closes.
  drawHeading?(parent: HTMLElement, title: string): DrawnPickerRow;
}

// What a request's `drawRow` draws one row with.
export interface DrawRowInput {
  label: string;
  trailing: HTMLElement | null;
  // True on the row at the cursor.
  isCursor: boolean;
}

// A row `drawRow` drew and the dispose of its draw: a layout host
// `DrawnPart`'s shape, with the drawn root as `element`.
export interface DrawnPickerRow {
  element: HTMLElement;
  dispose(): void;
}

// One floating list, holding one request at a time: `open` replaces the open
// request, if any, without hearing its cancel. Its scope is pushed while it
// shows, and the base scope changing under it cancels it; a click on the layer
// outside the panel runs `picker.cancel` with the owner's id. A row's click
// runs `picker.chooseRow` with the owner's id and the row's item index, which
// reaches `chooseAt`. `choose` with nothing visible does nothing;
// `close` hides it without hearing a cancel. A filter shows the rows it keeps
// best match first, the cursor on the first.
// A request's `headerEnd` sits at the end of the title line while it is open,
// and its `cursorEnd` at the trailing end of the cursor row only, moved there
// on each draw.
// With a filter editor, `focusFilter` types into the filter box above the
// list and logs `picker filter: <title>`, and `leaveFilter` leaves it with the
// filter kept, logging `picker list: <title>` when the box held focus; without
// one both do nothing. A request's `drawRow` draws each row; the picker sets the
// row's title, `is-selected` and `is-cursor`, and the click that runs
// `picker.chooseRow` for its item.
// A cursor move draws only the row the cursor left and the row it reached;
// `top` and `bottom` move it to the first and last visible row, in the shown
// order, and do nothing while closed or with no row visible.
// A request's `section` adds headings between the rows while no filter is
// typed; the cursor and `cursorIndex` count items only.
export interface ListPicker {
  // The transparent layer holding the panel, filling the positioned box the
  // caller places it in.
  element: HTMLElement;
  open<T>(request: ListPickerRequest<T>): void;
  isOpen(): boolean;
  // The open request's item index under the cursor; null when closed or
  // nothing is visible.
  cursorIndex(): number | null;
  down(): void;
  up(): void;
  top(): void;
  bottom(): void;
  choose(): void;
  // Moves the cursor to item `index` and chooses it; an index no visible row
  // shows does nothing and logs `picker row <index> is not shown`.
  chooseAt(index: number): void;
  cancel(): void;
  close(): void;
  focusFilter(): void;
  leaveFilter(): void;
  // Draws the open request's rows again, as after a new layout; nothing when
  // closed.
  redraw(): void;
}

export interface ListPickerOptions {
  // The owner's short scope pushed while the list shows, read at each push.
  // Default `picker`.
  scope?: string | (() => string);
  // Adds the filter box above the list, on the plugin's editor service, and
  // the `/ filter` key at the title line's end, ahead of `headerEnd`.
  // Default false.
  filter?: boolean;
  // The element the list goes in. Default: the window's overlay.
  parent?: HTMLElement;
}

// `create` builds one list, placed where `parent` says, under the plugin's own
// scope, log and editor, its clicks running `picker.chooseRow` and
// `picker.cancel` with the plugin's id as owner; the part's stop closes it with
// no cancel and frees the owner. Call it once per part start: its overlay entry
// lasts until the part stops, and a second call in one part start throws
// `picker owner <id> is taken`. A scope the
// manifest does not declare throws `Plugin "<id>" declares no scope "<name>"`,
// at the call for a string or a function's first value, and at the push for a
// function's later value.
export interface ListPickerService {
  create(options?: ListPickerOptions): ListPicker;
}
