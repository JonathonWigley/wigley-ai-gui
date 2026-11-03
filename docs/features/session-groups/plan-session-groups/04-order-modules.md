# 04 — Side bar order, recency and favorites modules

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/sessions/page/sidebar-order.ts` · test `src/plugins/sessions/page/sidebar-order.test.ts` ·
           create `src/plugins/sessions/page/session-recency.ts` · test `src/plugins/sessions/page/session-recency.test.ts` ·
           create `src/plugins/sessions/page/project-favorites.ts` · test `src/plugins/sessions/page/project-favorites.test.ts`
Consumes:  `Clock` (`src/contracts/ambient.ts`), `UiState` (`src/contracts/ui-state.ts`) — tree
Produces:  in `sidebar-order.ts`:
           `export interface OrderedRow { sessionId: string; project: string }`
           `export interface SidebarGroup<R extends OrderedRow> { project: string; isFavorite: boolean; rows: R[] }`
           `export interface SidebarSections<R extends OrderedRow> { favorites: SidebarGroup<R>[]; recent: SidebarGroup<R>[] }`
           `export function sidebarSections<R extends OrderedRow>(rows: readonly R[], favorites: readonly string[], stamps: ReadonlyMap<string, number>): SidebarSections<R>`
           `export function drawnRows<R extends OrderedRow>(sections: SidebarSections<R>): R[]`
           in `session-recency.ts`:
           `export interface SessionRecency { stamps(): ReadonlyMap<string, number>; noteArrived(sessionId: string): boolean; noteNeedsYou(sessionId: string): void; keepOnly(sessionIds: Iterable<string>): void }`
           `export function createSessionRecency(clock: Clock, uiState: UiState): SessionRecency`
           in `project-favorites.ts`:
           `export interface ProjectFavorites { list(): readonly string[]; isFavorite(project: string): boolean; toggle(project: string): boolean; move(project: string, by: 1 | -1, shown: readonly string[]): boolean; place(project: string, index: number, shown: readonly string[]): void; remove(project: string): void }`
           `export function createProjectFavorites(uiState: UiState): ProjectFavorites`
Decisions: mockup 4's two sections (round 2) · recency = arrival or needs you (round 2) · favorites are projects, an
           unshown favorite draws nothing and keeps its place (round 2) · drag only in Favorites (round 2) ·
           `uiState` keys `recency` and `favorites` (Decided) · `OrderedRow` keeps these modules off `SessionRow`, so
           they land in wave 1 (the smallest input the order needs)

**sidebarSections** — rows group by `project`. Favorites hold the favorited projects that have rows, in
`favorites` order. Recent holds every other group, most recent first; a group's recency is its newest row's stamp.
Inside every group rows run newest first. A row with no stamp counts as older than every stamped row. Tied rows
keep the order of `rows`; tied groups keep the order their first row appears in `rows`. `drawnRows` is every row in drawn order: favorites' groups, then recent's.

**SessionRecency** — stamps by app session id, read from and written to `uiState` key `recency` as
`Record<string, number>`; a value that is not such a record reads as empty. `noteArrived` stamps `clock.now()`
only for a session with no stamp, returning whether it stamped (a page reload re-sends every row, which must not
restamp). `noteNeedsYou` always stamps. A saved value that is not an object whose every value is a number reads as
empty, the whole record dropped. `keepOnly` drops every stamp outside the ids, so a row that leaves and
comes back stamps again. Each change writes the record.

**ProjectFavorites** — an ordered array of project names in `uiState` key `favorites`; a value that is not a
string array reads as empty. `toggle` appends a non-favorite at the end, or removes a favorite; returns whether
the project is a favorite after. `move` swaps the project with the next favorite in `shown` (the favorites that
have rows, in order) toward `by`, leaving unshown favorites where they are in the saved array; false for a
non-favorite or at the edge of `shown`; true when it moved. `place` counts `index` as task 03's drop does: among
`shown` without `project`. It removes `project` from the saved array, then inserts it before the `index`-th item of
`shown` minus `project`, or right after the last such item when `index` equals that list's length, or at the end of
the saved array when that list is empty; `index` clamps to `0..length`. It favorites a project that was not one.
`remove` unfavorites. Each change writes the array. A saved value that is not an array of non-empty strings reads as
empty; duplicates read once, first place kept.

GIVEN rows a1(alpha), b1(beta), a2(alpha), c1(gamma) with stamps a1=1, b1=4, a2=3, c1=2 and favorites [gamma]
WHEN sidebarSections runs THEN favorites = [gamma: c1], recent = [beta: b1], [alpha: a2, a1]
GIVEN favorites [beta, gone, alpha] where `gone` has no rows WHEN sidebarSections runs THEN favorites are beta then alpha, and no group is drawn for `gone`
GIVEN two rows of one project with no stamps WHEN sidebarSections runs THEN they keep the order of `rows`
GIVEN saved favorites [a, hidden, b] and shown [a, b] WHEN move(b, -1, shown) THEN saved is [b, hidden, a]
GIVEN saved favorites [a, b] WHEN move(a, -1, [a, b]) THEN false and saved is unchanged
GIVEN saved favorites [a, b] WHEN place(c, 1, [a, b]) THEN saved is [a, c, b]; WHEN place(a, 1, [a, b]) THEN [b, a]; WHEN place(a, 0, [a, b]) THEN [a, b]
GIVEN saved favorites [hidden] and shown [] WHEN place(c, 0, []) THEN saved is [hidden, c]
GIVEN saved favorites [a] WHEN toggle(b) THEN true and saved is [a, b]; WHEN toggle(a) THEN false and saved is [b]
GIVEN saved favorites [a, b] WHEN move(a, 1, [a, b]) THEN true and saved is [b, a]; WHEN move(c, 1, [a, b]) THEN false
GIVEN rows u1(alpha, no stamp), s1(alpha, stamp 1) WHEN sidebarSections runs THEN alpha's rows are s1, u1
GIVEN rows x1(xray), y1(yank) with equal stamps WHEN sidebarSections runs THEN recent is xray then yank
GIVEN a session stamped 5 and the clock at 9 WHEN noteNeedsYou runs THEN its stamp is 9
GIVEN saved recency or favorites of null, [], or {a: 'x'} WHEN read THEN each reads as empty
GIVEN a stamped session WHEN noteArrived runs THEN it returns false and the stamp is unchanged; WHEN keepOnly drops it and noteArrived runs THEN it is stamped again
Tests:     `sidebarSections_ordersSectionsGroupsAndRows` — one table over every order GIVEN plus a `drawnRows` assertion on the first ·
           `favorites_toggleMoveAndPlace` — one table over the toggle, move and place GIVENs, plus a uiState round trip ·
           `recency_stampsArrivalOnceAndNeedsYouAlways` — the two recency GIVENs plus a uiState round trip ·
           `savedValues_readInvalidAsEmpty` — one table over the invalid-value GIVEN for both keys
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof
