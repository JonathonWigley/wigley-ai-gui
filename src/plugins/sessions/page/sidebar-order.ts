// The order the Sessions side bar draws its rows in: two sections of project
// groups, Favorites and Recent, then the registered sections that claim a row,
// each holding its rows flat. Pure, over the smallest row the order needs.

export interface OrderedRow {
  sessionId: string;
  project: string;
}

// A registered section as the order reads it: its id, its place among the
// registered sections, and which rows it takes out of the project groups.
export interface RowClaim<R extends OrderedRow> {
  id: string;
  order: number;
  claims(row: R): boolean;
}

export interface SidebarGroup<R extends OrderedRow> {
  project: string;
  isFavorite: boolean;
  rows: R[];
}

// A registered section and the rows it claimed, newest first.
export interface ClaimedSection<R extends OrderedRow, S extends RowClaim<R>> {
  section: S;
  rows: R[];
}

export interface SidebarSections<
  R extends OrderedRow,
  S extends RowClaim<R> = RowClaim<R>,
> {
  favorites: SidebarGroup<R>[];
  recent: SidebarGroup<R>[];
  plugins: ClaimedSection<R, S>[];
}

const NO_STAMP = -Infinity;

// `rows` grouped by project, less the rows a section in `sections` claims.
// Favorites holds the favorited projects that have rows, in `favorites` order;
// Recent every other group, most recent first by its project's stamp, a project
// with no stamp older than every stamped one. Every section's `claims` is asked
// of every row; a row two sections claim goes to the lower `order`, a tie to
// the one earlier in `sections`. `plugins` holds the sections that claimed a
// row, by `order`, a tie in `sections` order. Rows run newest first inside
// every group and section, a row with no stamp older than every stamped row.
// Tied rows keep the order of `rows`, and tied groups the order their first
// row appears in it.
export function sidebarSections<R extends OrderedRow, S extends RowClaim<R>>(
  rows: readonly R[],
  favorites: readonly string[],
  stamps: ReadonlyMap<string, number>,
  projectStamps: ReadonlyMap<string, number>,
  sections: readonly S[],
): SidebarSections<R, S> {
  const stampOf = (row: R) => stamps.get(row.sessionId) ?? NO_STAMP;
  const byNewest = (left: R, right: R) =>
    newestFirst(stampOf(left), stampOf(right));
  // A stable sort, so a tie keeps registration order.
  const byOrder = [...sections].sort((left, right) => left.order - right.order);
  const claimedRows = new Map<S, R[]>(byOrder.map((section) => [section, []]));
  const rowsByProject = new Map<string, R[]>();
  for (const row of rows) {
    const claimant = claimantOf(byOrder, row);
    if (claimant !== undefined) {
      claimedRows.get(claimant)?.push(row);
      continue;
    }
    const projectRows = rowsByProject.get(row.project) ?? [];
    projectRows.push(row);
    rowsByProject.set(row.project, projectRows);
  }
  for (const projectRows of rowsByProject.values()) {
    projectRows.sort(byNewest);
  }

  const favorited = new Set(favorites);
  const favoriteGroups: SidebarGroup<R>[] = [];
  for (const project of favorited) {
    const projectRows = rowsByProject.get(project);
    if (projectRows !== undefined) {
      favoriteGroups.push({ project, isFavorite: true, rows: projectRows });
    }
  }
  const recentGroups: SidebarGroup<R>[] = [];
  for (const [project, projectRows] of rowsByProject) {
    if (!favorited.has(project)) {
      recentGroups.push({ project, isFavorite: false, rows: projectRows });
    }
  }
  const projectStampOf = (group: SidebarGroup<R>) =>
    projectStamps.get(group.project) ?? NO_STAMP;
  recentGroups.sort((left, right) =>
    newestFirst(projectStampOf(left), projectStampOf(right)),
  );
  const plugins: ClaimedSection<R, S>[] = [];
  for (const [section, sectionRows] of claimedRows) {
    if (sectionRows.length > 0) {
      plugins.push({ section, rows: sectionRows.sort(byNewest) });
    }
  }
  return { favorites: favoriteGroups, recent: recentGroups, plugins };
}

// `sections` narrowed to the one registered section `sectionId`: no Favorites
// or Recent groups, and that section with the rows it claimed, its header over
// no rows when it claimed none; no section when none in `registered` holds
// that id.
export function onlySection<R extends OrderedRow, S extends RowClaim<R>>(
  sections: SidebarSections<R, S>,
  registered: readonly S[],
  sectionId: string,
): SidebarSections<R, S> {
  const section = registered.find((each) => each.id === sectionId);
  if (section === undefined) {
    return { favorites: [], recent: [], plugins: [] };
  }
  const claimed = sections.plugins.find(
    (each) => each.section.id === sectionId,
  );
  return {
    favorites: [],
    recent: [],
    plugins: [{ section, rows: claimed?.rows ?? [] }],
  };
}

// Every row in drawn order: favorites' groups, then recent's, then each
// registered section's rows.
export function drawnRows<R extends OrderedRow>(
  sections: SidebarSections<R, RowClaim<R>>,
): R[] {
  return [
    ...[...sections.favorites, ...sections.recent].flatMap(
      (group) => group.rows,
    ),
    ...sections.plugins.flatMap((claimed) => claimed.rows),
  ];
}

// The first of `byOrder` that claims `row`, every section asked.
function claimantOf<R extends OrderedRow, S extends RowClaim<R>>(
  byOrder: readonly S[],
  row: R,
): S | undefined {
  const claimants = byOrder.filter((section) => section.claims(row));
  return claimants[0];
}

// A move of the side bar list's cursor: one row down or up, or to an end.
export type CursorMove = 1 | -1 | 'first' | 'last';

// The session id the cursor lands on after `move` over `order`, the drawn row
// ids: a step clamps at the ends; a cursor that is null or not in `order`
// lands on the first row; null for no rows.
export function movedCursor(
  order: readonly string[],
  cursorId: string | null,
  move: CursorMove,
): string | null {
  if (order.length === 0) {
    return null;
  }
  const index = cursorId === null ? -1 : order.indexOf(cursorId);
  if (index === -1 || move === 'first') {
    return order[0] ?? null;
  }
  if (move === 'last') {
    return order.at(-1) ?? null;
  }
  const next = Math.min(Math.max(index + move, 0), order.length - 1);
  return order[next] ?? null;
}

// The cursor once the drawn rows change from `before` to `after`: it stays on
// its row while that row is drawn; a row that left gives the row now at the
// index it held, clamped to the last row; a cursor that is null or was not in
// `before` takes the first row; null for no rows.
export function cursorAfterDraw(
  before: readonly string[],
  after: readonly string[],
  cursorId: string | null,
): string | null {
  if (cursorId !== null && after.includes(cursorId)) {
    return cursorId;
  }
  const index = cursorId === null ? -1 : before.indexOf(cursorId);
  if (index === -1) {
    return after[0] ?? null;
  }
  return after[Math.min(index, after.length - 1)] ?? null;
}

function newestFirst(left: number, right: number): number {
  // -Infinity minus itself is NaN.
  return left === right ? 0 : right - left;
}
