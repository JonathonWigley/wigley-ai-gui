# 01 — Arrangement rule and the override setting

Status: not started
Type: Batch
Rung: hard · adds the `ModePlace`, `ActivityBarSetting` and `arrangeActivityItems` contracts that 02 and 03 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/renderer/shell/activity-order.ts` · test `src/renderer/shell/activity-order.test.ts` · modify `src/contracts/plugin.ts` · modify `src/contracts/settings.ts` · modify `src/config/settings.ts` · test `src/main/config/user-settings.test.ts` · modify `CHANGELOG.md`
Consumes:  nothing
Produces:  `export interface ModePlace { group: number; order: number; at?: 'top' | 'bottom' }` in `src/contracts/plugin.ts`
           `Mode.place?: ModePlace` and `Mode.showCommand?: string` in `src/contracts/plugin.ts`
           `export interface ActivityBarGroupSetting { modes: string[]; at?: 'top' | 'bottom' }` in `src/contracts/settings.ts`
           `export interface ActivityBarSetting { groups: ActivityBarGroupSetting[]; hidden: string[] }` in `src/contracts/settings.ts`
           `Settings.shell.activityBar: ActivityBarSetting` in `src/contracts/settings.ts`
           `export interface ActivityModeEntry { id: string; place: ModePlace | undefined; firstAdd: number }` in `src/renderer/shell/activity-order.ts`
           `export interface ActivityGroups { top: string[][]; bottom: string[][] }` in `src/renderer/shell/activity-order.ts`
           `export function arrangeActivityItems(modes: readonly ActivityModeEntry[], setting: ActivityBarSetting): ActivityGroups` in `src/renderer/shell/activity-order.ts`

Decisions:
- `Mode.place` doc comment: the mode's suggested place in the activity bar; `group` and `order` lower first, `at` the
  edge (`top` when left out); the `shell.activityBar` setting overrides it. `Mode.showCommand` doc comment: the
  plugin's own command id (unqualified, as the mode's `id` is) that shows the mode; the bar shows its key.
- The arrangement rule, from `docs/features/activity-bar/design.md` § Order and groups:
  - With `setting.groups` empty: modes split by `place.at ?? 'top'`; within an edge, grouped by `place.group`, groups
    ascending; within a group, by `place.order`, ties by `firstAdd`. Modes with no `place` form one last top group in
    `firstAdd` order.
  - With `setting.groups` non-empty: each setting group, in order, becomes a group on its `at ?? 'top'` edge, holding
    its listed ids that name an added mode, in the setting's order. Every added mode listed in no group and not in
    `hidden` forms one group after the last top group, sorted as the suggestions sort (edge ignored: `at`, then
    `group`, then `order`, then `firstAdd`, modes with no `place` last).
  - `hidden` removes its ids in both cases. A group left empty is dropped, one whose ids are all unknown included.
    An id listed twice keeps its first place.
  - With every setting group on the bottom edge, the unlisted modes' group is the first top group.
- `ActivityModeEntry.id` is the qualified mode id, the one `modes.show` takes and the setting names
  (`work-inbox.main`).
- Main does not check the setting's shape: `checkElements` in `src/main/config/user-settings.ts` takes any elements
  against an empty default array, and the default must stay empty. So `arrangeActivityItems` takes what main hands
  it and tolerates a malformed value: a group that is no object or has no `modes` array is skipped, an id that is no
  string is skipped, an `at` other than `'bottom'` reads as `'top'`, and a `hidden` that is no array reads as empty.
- `shell.activityBar` default `{ groups: [], hidden: [] }`. `SettingPath` recurses into the object, so it has two
  leaves, each with a `settingInfo` row and no `settingControls` entry (an array leaf already takes the `json`
  control in `settingControl`, `src/main/config/user-config.ts`):
  - `shell.activityBar.groups`: label `Activity bar groups`, description
    `The activity bar's groups, top to bottom, each listing mode ids (sessions.sessions, work-inbox.main) and an optional at: bottom. Empty keeps each plugin's suggested order.`
  - `shell.activityBar.hidden`: label `Hidden activity bar modes`, description
    `Mode ids the activity bar leaves out; their keys still show them.`
- `README.md` already names both leaves (written ahead with this plan); `scripts/readme-coverage.test.mts` checks
  every `settingInfo` key against it.
- CHANGELOG `### Added`: `The shell.activityBar setting orders, groups and hides the activity bar's modes, overriding each plugin's suggested place.`

GIVEN modes with places in two top groups and one bottom group, added out of order WHEN arranged with an empty setting THEN the groups come back sorted by edge, group and order
GIVEN a setting listing two groups that leave one added mode out WHEN arranged THEN the left-out mode forms a group after the last top group
GIVEN a hidden id WHEN arranged with or without setting groups THEN no group holds it

Tests:     `arrangeActivityItems_SortsAndGroupsModes` in `activity-order.test.ts` — one `it.each` table over (modes, setting) → literal `ActivityGroups`, rows: suggestions only across both edges with ties broken by `firstAdd`; a mode with no place; setting groups with a bottom group; an unlisted mode with a bottom suggestion landing after the last top group; an unknown id skipped; an id listed twice; `hidden` with and without groups; a group emptied by `hidden` dropped; a group of only unknown ids dropped; every setting group at the bottom, the unlisted modes forming the first top group; malformed values (a string in `groups`, a group with no `modes`, a number among the ids, `at: 'left'`, `hidden` not an array) skipped or read as the decisions say. Rows use general values: distinct `group` and `order` numbers, `firstAdd` out of id order.
           A case in `mergeUserSettings`'s tests (`src/main/config/user-settings.test.ts`): a `shell` holding only `activityBar.hidden` merges over the defaults, keeping `groups` at `[]` and `shell.layout` at its default; a two-group value comes back as written.
Done when: compiles; lint passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

