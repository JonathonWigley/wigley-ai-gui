// The order the Sessions side bar draws its rows in: two sections of project
// groups. Pure, over the smallest row the order needs.

export interface OrderedRow {
  sessionId: string;
  project: string;
}

export interface SidebarGroup<R extends OrderedRow> {
  project: string;
  isFavorite: boolean;
  rows: R[];
}

export interface SidebarSections<R extends OrderedRow> {
  favorites: SidebarGroup<R>[];
  recent: SidebarGroup<R>[];
}

const NO_STAMP = -Infinity;

// `rows` grouped by project. Favorites holds the favorited projects that have
// rows, in `favorites` order; Recent every other group, most recent first by its
// project's stamp, a project with no stamp older than every stamped one. Rows run
// newest first inside every group, a row with no stamp older than every stamped
// row. Tied rows keep the order of `rows`, and tied groups the order their first
// row appears in it.
export function sidebarSections<R extends OrderedRow>(
  rows: readonly R[],
  favorites: readonly string[],
  stamps: ReadonlyMap<string, number>,
  projectStamps: ReadonlyMap<string, number>,
): SidebarSections<R> {
  const stampOf = (row: R) => stamps.get(row.sessionId) ?? NO_STAMP;
  const rowsByProject = new Map<string, R[]>();
  for (const row of rows) {
    const projectRows = rowsByProject.get(row.project) ?? [];
    projectRows.push(row);
    rowsByProject.set(row.project, projectRows);
  }
  for (const projectRows of rowsByProject.values()) {
    projectRows.sort((left, right) =>
      newestFirst(stampOf(left), stampOf(right)),
    );
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
  return { favorites: favoriteGroups, recent: recentGroups };
}

// Every row in drawn order: favorites' groups, then recent's.
export function drawnRows<R extends OrderedRow>(
  sections: SidebarSections<R>,
): R[] {
  return [...sections.favorites, ...sections.recent].flatMap(
    (group) => group.rows,
  );
}

function newestFirst(left: number, right: number): number {
  // -Infinity minus itself is NaN.
  return left === right ? 0 : right - left;
}
