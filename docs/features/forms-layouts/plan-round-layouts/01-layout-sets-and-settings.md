# 01 — Layout sets and the layout settings

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

The shared registry announces every layout in the folder, each with its own revision. The user's layout comes from
the `forms.layout` and `chat.layout` settings. The cycle and copy commands, keys and channel calls go from both
plugins. The page keeps one layout at a time in this task: the shared `showLayouts` draws the layout the plugin's
setting names. Task 03 replaces the forms page's use of it with the multi-layout loader; chat keeps it.

Files:
- modify `src/contracts/layouts.ts`
- modify `src/shared/layouts/layout-registry.ts` · test `src/shared/layouts/layout-registry.test.ts`
- modify `src/shared/page/layout-loader.ts` · test `src/shared/page/layout-loader.test.ts`
- modify `src/plugins/forms/contract.ts` (the layout re-export and `FormsChannel` only)
- modify `src/plugins/chat/contract.ts` (`ChatChannel` only)
- modify `src/plugins/forms/main/start.ts` · modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/forms/manifest.ts` · modify `src/plugins/chat/manifest.ts`
- modify `src/plugins/keymap.ts`
- modify `src/plugins/forms/page/start.ts` · modify `src/plugins/forms/page/forms-commands.ts` · test
  `src/plugins/forms/page/forms-commands.test.ts`
- modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat-commands.ts`
- modify `src/plugins/forms/main/selftest-script.ts` (delete the `layout cycle` group only)

Consumes: nothing from another task. `PageApi.settings()` and `PageApi.onSettingsChanged(listener)` already exist in
`src/contracts/plugin.ts` (lines 443-444).

Produces:
- `src/contracts/layouts.ts` — `LayoutChoice` is deleted and replaced by:
  - `export interface LayoutEntry { name: string; revision: number; hasCss: boolean; builtIn: boolean }`
  - `export interface LayoutSet { layouts: LayoutEntry[]; changed: string | null }`
- `src/shared/layouts/layout-registry.ts`:
  - `export interface LayoutRegistry { current(): LayoutSet; names(): string[]; dispose(): void }`
  - `export interface LayoutRegistryDeps { data: Files; send(set: LayoutSet): void; log: Log; logSource: string; layoutTypes: string }`
    (`defaultLayout` is removed: only `copy` read it)
  - `export async function startLayoutRegistry(deps: LayoutRegistryDeps): Promise<LayoutRegistry>` (signature as today)
- `src/plugins/forms/contract.ts`:
  - `export type { LayoutEntry, LayoutSet } from '../../contracts/layouts';` (replaces the `LayoutChoice` re-export,
    so task 03 does not edit this file)
  - `FormsChannel.invoke.layout(): Promise<LayoutSet>` · `FormsChannel.messages.layoutChanged: LayoutSet` ·
    `cycleLayout` and `copyLayout` removed · `openPreview(): void` stays
- `src/plugins/chat/contract.ts` — `ChatChannel.invoke.layout(): Promise<LayoutSet>` ·
  `ChatChannel.messages.layoutChanged: LayoutSet` · `cycleLayout` and `copyLayout` removed
- `src/plugins/forms/manifest.ts` — `settings: { autosaveDelayMs: 400, deadlineSeconds: 240, layout: 'default' }`;
  commands `nextLayout`, `prevLayout`, `copyLayout` removed; `openPreview` stays
- `src/plugins/chat/manifest.ts` — `settings: { profiles: DEFAULT_PROFILES, layout: 'default' }`; commands
  `nextLayout`, `prevLayout`, `copyLayout` removed
- `src/shared/page/layout-loader.ts`:
  - `export interface LayoutLoader<L> { load(entry: LayoutEntry): Promise<L> }`
  - `export function layoutUrls(entry: LayoutEntry, dataUrl: (path: string, revision: number) => string): { script: string; style: string | null }`
  - `export interface LayoutChannel { onLayoutChanged(listener: (set: LayoutSet) => void): void; readLayout(): Promise<LayoutSet> }`
  - `export interface ShowLayoutsDeps<L> { channel: LayoutChannel; loader: LayoutLoader<L>; chosen(): string; onChosenChanged(listener: () => void): void; setLayout(layout: L, name: string): void; log: Log; logSource: string; toast(text: string, tone: ToastTone): void }`
    (`dataFolderLabel` is removed: only the copied toast read it)
  - `export function showLayouts<L>(deps: ShowLayoutsDeps<L>): void`
- `src/plugins/forms/page/forms-commands.ts` — `export interface LayoutCommandChannel { openPreview(): Promise<unknown> }`

Decisions:
- **Per-layout revisions (plan: Design review, seam).** The registry keeps one revision counter per layout name for
  the life of the process. A name starts at 1 the first time the registry lists it. Each change report the registry
  acts on for a name adds 1 to that name's counter, also when the change removes the layout. The counter is never
  reset, so a layout that goes and comes back gets a higher revision, and the page never loads a module URL it
  loaded before for other code. `default` is always revision 1, `builtIn: true`, `hasCss: false`.
- **Which change reports the registry acts on.** As today it ignores: a path with no folder (a top-level file such as
  `layouts/layout.d.ts`), the `default` folder, a file name that does not match `LAYOUT_FILE`, and a dot file. For
  every other report in folder X it lists the layouts again (through the `serially` queue). It announces when X is in
  the new list, or X was in the list before. It announces nothing when X was never a layout (a folder with no
  `layout.js`). The announced set has `changed: X`. The active-folder check (today line 172) goes: every folder is
  watched.
- **What `current()` returns.** The set from the last listing, with `changed: null`. `names()` returns the names of
  that same listing, `default` first, then the user layouts sorted by name (the order `listLayouts` gives today).
- **Removed with cycle and copy.** `cycle`, `copy`, `activate`, `freeCopyName`, `readActiveName`, `ACTIVE_FILE`, and
  the own-write marks (`ownWrites`, `forgetOwnWrite`, `writeOwn`, `OWN_WRITE_MS`) go: only `copy` wrote into layout
  folders, and the `layout.d.ts` write is a top-level file the watch ignores. The registry no longer reads or writes
  `layouts/active`; a `layouts/active` file left in a user's folder is not read and not deleted (one user, no
  migration).
- **The page in this task shows one layout: the one the plugin's setting names.** `showLayouts` keeps the latest
  set (the `layout` answer, or a `layoutChanged` message; a message heard before the answer drops the answer, as
  today). Its target is the set entry whose name is `chosen()`. When no entry has that name, the target is the
  `default` entry, and it logs `layout <name> not found, drawing default` (`<name>` is the setting's value). It logs
  this line once each time the missing name changes; a found name clears it. It loads the target only when the
  target's name or revision differs from the last target it queued, so a save in a layout nobody draws loads
  nothing. It checks the target again on each set and on each `onChosenChanged`. Loads stay serial in arrival
  order, as today.
- **Log and toast lines.** After `setLayout`: `layout <name> shown (revision <n>)`. A failed load: log
  `layout <name> failed: <error>` and toast `Layout <name> failed: <error>` (tone `error`), and the current layout
  stays; the failed name and revision count as queued, so the next save of that layout tries again. A throw in
  `setLayout`: `layout <name> not shown: <error>`. An answer that rejects: `layout not read: <error>`. The `cycled`
  and `copied` toasts, `layoutToast` and the `reason` field go.
- **The loader keeps one stylesheet link in this task.** `createLayoutLoader` changes only its input type
  (`LayoutEntry` for `LayoutChoice`). The link per layout with `data-layout` is task 03's.
- **Page wiring.** Forms: `chosen: () => api.settings().layout` and
  `onChosenChanged: (listener) => { api.onSettingsChanged(() => listener()); }`. Chat: the same over chat's `api`.
  Both drop `dataFolderLabel`. Plan File Structure says "`settings()` and `onChanged`": the API's member is
  `onSettingsChanged`.
- **Setting declarations**, verbatim, in each manifest's `settingInfo`:
  - forms `layout`: label `Layout`, description
    `The forms layout that draws what a round and its items do not name a layout for: a folder name in forms' layouts folder, or default.`
  - chat `layout`: label `Layout`, description
    `The chat layout every Chat tab draws in: a folder name in chat's layouts folder, or default.`
- **Keys.** `src/plugins/keymap.ts` drops the binds `<Leader>zln`, `<Leader>zlp`, `<Leader>zlc`, `<Leader>zcn`,
  `<Leader>zcp`, `<Leader>zcc` and the group `'<Leader>zc': 'chat layouts'`. `<Leader>zlo` and the group
  `'<Leader>zl': 'forms layouts'` stay (`docs/keymap.md` already says this).
- **Commands.** `formsCommandHandlers` drops `nextLayout`, `prevLayout`, `copyLayout`; `openPreview` stays on
  `layoutCommand`. Chat's handlers drop the same three, and chat's `layoutCommand` helper goes when nothing else
  calls it. The forms page's `layouts` dep passes only `openPreview`.
- **Main wiring.** Each `serveLayouts` passes `send: (set) => api.channel.send('layoutChanged', set)`, keeps the
  `layout` handler, and drops the `cycleLayout` and `copyLayout` handlers. Each `main/start.ts` drops its
  `defaultLayout from '../layouts/default/layout.js?raw'` import. Forms' comment above the fixture write (today
  lines 263-266) says instead: written before the registry starts so the registry lists `selftest`; a late watch
  report of the write announces a `selftest` change, which loads nothing while the setting names another layout.
- **Self-test.** The `layout cycle` group's keys `Space z l n/p` no longer exist, so the group is deleted whole:
  `LAYOUT_CYCLE_STEPS` and its entry in the script's group list go, and this task adds no group in its place. Its
  steps could not pass after 03 in any form (03's loader imports nothing for a `builtIn` entry, so
  `layout default shown` is never logged). Task 08 adds the `round layouts` group, which drives the setting, at the
  same place in the script. The comment above `SELFTEST_LAYOUT` says "so the registry lists `default` and
  `selftest`" in place of "the layout cycle holds". The `<C-k>` step's `why` in `REVIEW_STEPS` still names the
  layout cycle; 08 rewords it. The self-test does not run until task 10.

GIVEN layouts `alpha` and `beta` WHEN a file in `beta` is saved THEN the registry sends a set with `changed: 'beta'`,
`beta`'s revision 1 higher, and `alpha`'s revision the same.
GIVEN `forms.layout` names `gone`, which the set does not hold WHEN the page reads the set THEN it draws `default`
and logs `layout gone not found, drawing default`.
GIVEN the page draws `alpha` WHEN `beta` is saved THEN the page loads nothing.

Tests (`src/shared/layouts/layout-registry.test.ts`; the `cycle` and `copy` describes and every `layouts/active`
setup go; the `send` spy records `LayoutSet`s):
- `start_WritesLayoutTypes` — kept as it is.
- `start_ListsDefaultFirstThenUsersByName` — with `beta` and `alpha` written, `current()` equals
  `{ layouts: [default (revision 1, builtIn true, hasCss false), alpha (revision 1, builtIn false), beta (revision 1)], changed: null }`.
- `start_UserFolderNamedDefault_IsSkippedAndLogged` — with `default` and `alpha` written, `names()` is
  `['default', 'alpha']` and the log holds `[demo] layouts/default is ignored; the built-in default layout wins`.
- `start_FolderWithoutLayoutJs_IsNotListed` — `layouts/notes/readme.json` alone gives `names()` `['default']`.
- `watch_SaveInAnyUserFolder_BumpsOnlyThatLayout` — save `beta/layout.js`; the one sent set has `changed: 'beta'`,
  `beta` at revision 2 and `alpha` at revision 1.
- `watch_LayoutJsRemoved_SendsSetWithoutIt` — remove `alpha/layout.js`; the sent set has `changed: 'alpha'` and no
  `alpha` entry, and `names()` is `['default']`.
- `watch_LayoutRemovedThenWrittenAgain_TakesAHigherRevision` — after remove and re-write of `alpha/layout.js`, the
  last sent `alpha` revision is greater than 2 (start 1, removal 2).
- `watch_NewFolder_JoinsTheSet` — write `gamma/layout.js` after start; the sent set holds `gamma` at revision 1 with
  `changed: 'gamma'`.
- `watch_SaveInFolderThatIsNoLayout_SendsNothing` — write `notes/readme.json`, then save `alpha/layout.js`; `sent`
  holds one set, with `changed: 'alpha'`.
- `watch_SaveInDefaultFolder_SendsNothing` — write `default/layout.js` after start, then save `alpha/layout.js`;
  `sent` holds one set, with `changed: 'alpha'`.
- `watch_EditorSideFile_%s_ChangesNothing` — the four side files as today, then a save of `alpha/layout.js`; `sent`
  holds one set, `alpha` at revision 2.
- `watch_SaveOf_%s_SendsTheChange` — the three paths as today; the sent set has `changed: 'alpha'`.
- `watch_Fails_LogsIt` — kept as it is.
- `hasCss_TrueWhenLayoutCssPresent` — after `alpha/layout.css` is written, the sent set's `alpha` entry and
  `current()`'s have `hasCss: true`.

Tests (`src/shared/page/layout-loader.test.ts`; builders take `LayoutEntry` and `LayoutSet`; the `showing` helper
takes a `chosen` value it can change and fires `onChosenChanged`):
- `layoutUrls_*` and `load_*` — kept, over `LayoutEntry`.
- `showLayouts_AnswerSet_ShowsTheChosenLayout` — chosen `mine`, answer set holds `default` and `mine` (revision 3);
  shown is `['mine']`, log `[demo] layout mine shown (revision 3)`.
- `showLayouts_ChosenMissing_ShowsDefaultAndLogs` — chosen `gone`; shown `['default']`; log holds
  `[demo] layout gone not found, drawing default` once, also after a second set.
- `showLayouts_ChangeToAnotherLayout_LoadsNothing` — chosen `mine` shown; a set with `changed: 'other'` and `mine`'s
  revision the same loads nothing more.
- `showLayouts_ChosenLayoutReloaded_LoadsItAgain` — a set with `mine` at revision 4 loads and shows `mine` again.
- `showLayouts_SettingChanged_LoadsTheNewChoice` — chosen goes from `mine` to `other`, then `onChosenChanged` fires;
  shown is `['mine', 'other']`.
- `showLayouts_Changes_ShownOneAtATimeInArrivalOrder` — kept, with two sets that each bump the chosen layout; no
  toast.
- `showLayouts_ChangeHeardBeforeAnswer_DropsAnswer` — kept, over sets.
- `showLayouts_LoadFails_LogsAndToasts` — kept; then a set with the next revision loads it again.
- `showLayouts_SetLayoutThrows_LaterChangesStillShown` — kept, over sets.
- `showLayouts_AnswerRejects_LogsNotRead` — kept.
- `showLayouts_Copied_ToastsTheDataFolderLabel` — deleted.

Tests (`src/plugins/forms/page/forms-commands.test.ts`): `nextLayout_InvokesCycleLayoutForward` and
`prevLayout_InvokesCycleLayoutBackward` are deleted, and the fake `layouts` dep holds only `openPreview`;
`openPreview_Rejects_ToastsError` stays.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass;
`grep -rnE "LayoutChoice|cycleLayout|copyLayout|forms\.nextLayout|forms\.prevLayout|chat\.nextLayout|chat\.prevLayout|'nextLayout'|'prevLayout'|nextLayout:|prevLayout:|layouts/active" src`
finds nothing, and `grep -n "name: 'layout cycle'\|LAYOUT_CYCLE_STEPS" src/plugins/forms/main/selftest-script.ts`
finds nothing. The grep names the command, handler and channel names only: `round-view.ts` keeps a local parameter named
`nextLayout` until 03 rewrites `setLayout`.

Commit: one commit for the group.

## Proof

Commit e44a22ec · proof: diff read: every Produces signature present; typecheck passes; worker ran lint and the three test files (90 tests) green · concerns: REVIEW_STEPS <C-k> why still names the layout cycle (08 rewords); both pages drop the onSettingsChanged disposable (brief's verbatim wiring); registry's 'not reloaded' catch now covers any folder's re-listing
