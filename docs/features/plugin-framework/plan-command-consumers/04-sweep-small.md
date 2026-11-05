# 04 — Sweep: agent-strip, visual, keys, shell

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task creates, modifies and tests.
- **Consumes** — the signatures this task uses, copied.
- **Produces** — the commands this task adds, by site.
- **Decisions** — each site, what stays, why sessions sits here.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — each with the break it catches.
- **Done when**, **Commit**, **Proof**.

## Files

Agent-strip:

- create `src/plugins/agent-strip/contract.ts`
- modify `src/plugins/agent-strip/manifest.ts`, `src/plugins/agent-strip/page/start.ts`, `src/plugins/agent-strip/page/agent-strip.ts`
- test `src/plugins/agent-strip/page/agent-strip.test.ts`

Visual:

- modify `src/plugins/visual/manifest.ts`, `src/plugins/visual/contract.ts`, `src/plugins/visual/page/start.ts`
- test `src/plugins/visual/page/start.test.ts`

Shell:

- modify `src/contracts/commands.ts`, `src/config/keymap.ts`, `src/renderer/renderer.ts`, `src/renderer/shell/shell-chrome.ts`
- test `src/renderer/shell/shell-chrome.test.ts`

Sessions:

- modify `src/plugins/sessions/manifest.ts`, `src/plugins/sessions/contract.ts`, `src/plugins/sessions/page/start.ts`, `src/plugins/sessions/page/sessions-view.ts`, `src/plugins/sessions/page/sidebar-view.ts`, `src/plugins/sessions/page/session-tabs-view.ts`, `src/plugins/sessions/page/sessions-view-fakes.ts`
- test `src/plugins/sessions/page/start.test.ts`, `src/plugins/sessions/page/sessions-view.test.ts`, `src/plugins/sessions/page/session-tabs-view.test.ts`, `src/plugins/sessions/page/layout/sessions-parts.test.ts`

Keys: no file changes (Decisions).

## Consumes

From `plan-commands-and-state`:

- `export type CommandArgShape = 'number' | 'string' | { readonly [field: string]: 'number' | 'string' };` and `export interface CommandKey<A, Id extends string = string> { readonly id: Id; readonly argType?: A; }`, in `src/contracts/commands.ts`.
- `CommandDecl` gains `arg?: CommandArgShape`. `PageCommandContext<A = undefined>` is `{ editor?: TextEditor; arg: A }`. A handler is `(context) => void | Promise<void>`.
- `commands.run(id: CommandId): Promise<void>` and `run<A>(key: CommandKey<A>, arg: A): Promise<void>`.

From task 01:

- `KitCommands`, with `run(id: CommandId, arg?: CommandArg): void`, in `src/shared/page/layout-host/base-kit.ts`. `OwnerKitServices.commands` carries it into the shell.
- A command with a declared `arg` lists only while a key binds it.

From the tree: `toggleOpen` and `revealBox` in `agent-strip.ts`. `overlay.open` and `createHtmlFence`'s `expand` dep in `visual/page/start.ts`. `ShellChrome` and its `items` map in `shell-chrome.ts`. `SidebarEvents.activate` and `toggleFavorite` in `sidebar-view.ts`. The `select` in `session-tabs-view.ts`, and `view.tabs.select` in `sessions/page/start.ts`.

## Produces

Each command takes no key, and each declares an `arg`, so none lists in Settings, help or the palette while unbound. Each runs `runsIn: 'page'`.

| Command | `arg` | Label | Group | Site |
|---|---|---|---|---|
| `agent-strip.toggleBoxAt` | `{ sessionId: 'string', key: 'string' }` | `open or close the named box` | `agent strip` | `agent-strip.ts:346` box click |
| `visual.expand` | `'string'` (the visual's HTML source) | `expand the visual` | `visual` | `visual-parts.ts:117`, through `html-fence.ts:90` |
| `modes.show` (core) | `'string'` (the qualified mode id) | `show the mode` | `modes` | `shell-chrome.ts:195` activity item |
| `sessions.selectRow` | `'string'` (session id) | `open the session` | `sessions` | `sidebar-view.ts:270` row |
| `sessions.selectTab` | `{ sessionId: 'string', tab: 'string' }` | `show the tab` | `sessions` | `session-tabs-view.ts:634`, reached through `:265` |
| `sessions.favoriteProjectAt` | `'string'` (project key) | `favorite or unfavorite the named project` | `projects` | `sidebar-view.ts:155` favorite toggle |

`CommandKey`s:

- `src/plugins/agent-strip/contract.ts`: `export const agentStripToggleBoxAt: CommandKey<{ sessionId: string; key: string }, 'agent-strip.toggleBoxAt'> = { id: 'agent-strip.toggleBoxAt' };` The file holds this one key.
- `src/plugins/visual/contract.ts`: `visualExpand: CommandKey<string, 'visual.expand'>`.
- `src/plugins/sessions/contract.ts`: `sessionsSelectRow`, `sessionsSelectTab`, `sessionsFavoriteProjectAt`, typed as the table gives.
- `src/contracts/commands.ts`: `export const MODES_SHOW: CommandKey<string, 'modes.show'> = { id: 'modes.show' };`

`src/renderer/shell/shell-chrome.ts`: `ShellChrome` gains `showMode(modeId: string): void`.

`src/plugins/agent-strip/page/agent-strip.ts`: the strip's returned object gains `toggleBoxAt(sessionId: string, key: string): void`, and its deps gain `run`, the page's command run for `agentStripToggleBoxAt`.

## Decisions

**Agent-strip.**

- The click runs `agent-strip.toggleBoxAt` with `{ sessionId, key }`. The handler calls `strip.toggleBoxAt`, which runs `toggleOpen` then `revealBox`, today's two calls.
- `toggleBox` stays for the key: it acts on the selected box and names no record. The click and key rule is task 02's: `<short>` means the focused or selected thing, and `<short>At` means the named thing.
- The click's handling of a card (`click_OnCard_LeavesItClosed`) stays as that test pins.

**Visual.**

- No visual id exists: `html-fence.ts` hands `expand` the visual's source string, and `overlay.open([source], 0)` takes that string. So the arg is the source. It adds no registry.
- `start.ts`'s `expand` dep runs `api.commands.run(visualExpand, source)`. The new handler holds `overlay.open([arg], 0)`.
- `html-fence.ts`, `visual-parts.ts` and `visual/layouts/layout.d.ts` do not change: the button still calls the closure, which now runs the command.

**Keys: no change.** A re-check of the site table found both sites already run a command. `help-view.ts`'s Close calls `close`, and `keys/page/start.ts:101` passes `() => api.commands.run(closeHelpCommand)` as `close`. `layouts/default/layout.js:55` passes `kit.command('keys.toggleHelp')`. The task keeps the plugin's name in its title, since the site table lists it.

`KeysKit.iconButton(parent, icon, label, onClick: () => void)` in `keys/layouts/layout.d.ts` still takes a function. It stays out of scope: `plan.md`'s signature change is on `kit.button`, and the default layout's only `iconButton` already gets a command runner.

**Shell activity item.**

- Each mode has a show command in its plugin: `docs.showMode`, `sessions.showMode`, `backlog.showMode`, `settings.showMode`, `gallery.showMode`, five `modes.add` calls and five commands, measured at plan time, re-verify.
- The activity click cannot run those. Backlog's, settings', sessions' and docs' toggle the side bar when the mode already shows (`backlog/page/start.ts:106`, `settings/page/start.ts:91`, `sessions/page/start.ts:596`, `docs/page/start.ts:540`). Gallery's does nothing then. The click on a shown mode does nothing today (`Mode` § `show`). Running them would change what the user sees, which `plan.md` § Boundary rules forbids in a sweep. The user's choice on this is in the plan run's report; this document keeps today's behaviour.
- The core owns `modes.show`, a `coreCommands` entry. The click runs `services.commands.run(MODES_SHOW.id, mode.id)`.
- The handler, registered in `renderer.ts` beside the pane commands, calls `chrome.showMode(arg)`. `showMode` runs `items.get(modeId)?.handle.show()`. An unknown id does nothing.
- This also holds the rule for a mode with no command of its own: every mode has a click, because the core holds one command for all modes. No plugin must declare anything, and no plugin's `start.ts` changes. That keeps this task off files task 05 edits.
- `<plugin>.showMode` stays for keys, with its side bar toggle.

**Sessions.**

- `sessions.selectRow`'s handler holds what the `activate` dep of `mountSessionsView` does at `start.ts:344` today: `exports.activate(sessionId)`, then `mode.picked()`. The dep runs the command.
- `sessions.selectTab`'s handler calls `view.tabs.select(sessionId, tab)`. `session-tabs-view.ts:265`'s closure runs the command, through a new dep `selectTab(sessionId: string, tabId: string): void` on the tabs view. `view.tabs.select` stays for `start.ts:645`. The `showed <tab> tab` log line stays in `start.ts:645`'s key path, so a click logs no such line, as today.
- `sessions.favoriteProjectAt`'s handler calls `view.toggleFavorite(project)`, the call the key's handler makes at `start.ts:840`. The `SidebarEvents` member stays and now runs the command, through a new `sessions-view.ts` dep `runFavorite(project: string): void`.
- `sessions.favoriteProject` stays for the key: it acts on the focused pane's session's project.
- **The layout preview's guard stays in `SidebarEvents`, before any command runs.** `SidebarEvents.activate` at `sessions-view.ts:174` runs the `activate` dep only when `preview === null`, and otherwise re-selects in the preview. `SidebarEvents.toggleFavorite` at `:182` runs `runFavorite` only when `preview === null`, and otherwise does nothing and logs nothing. A click in the preview therefore runs no command, activates no real session and favorites no real project. `view.toggleFavorite` keeps its own `projects ignored` guard for keys.
- `sessions-parts.ts:182`'s `() => undefined` stays. The real click listener is `sidebar-view.ts:155`, and the toggle's look is the part's job.
- `sessions-parts.ts:299`'s pane controls already run commands.

**Why sessions' sites sit here.** Task 07 edits the sessions plugin in Wave 4, after this task, so wave order keeps them apart. Tasks 02, 03 and 05 in this wave do not edit `src/plugins/sessions`. Task 03 (chat) reads sessions through its contract only, and must not edit that file; the lead confirms against task 03's and 05's Files.

**Same-wave files.** This task edits `src/config/keymap.ts`, `src/contracts/commands.ts`, `src/renderer/renderer.ts` and `shell-chrome.ts`. No other Wave 2 task may edit these; the lead confirms against tasks 03 and 05.

**Sweep.** What the user sees does not change. A click adds no log line of its own.

## Behaviour

- GIVEN a closed agent box in session `s` with key `k` WHEN the user clicks it THEN `agent-strip.toggleBoxAt` runs with `{ sessionId: 's', key: 'k' }`, the box opens and it scrolls into view.
- GIVEN a selected box WHEN the user presses the toggle key THEN `agent-strip.toggleBox` acts on the selected box, as today.
- GIVEN a drawn visual WHEN the user clicks Expand THEN `visual.expand` runs with its source, and the overlay opens on it.
- GIVEN Docs is not the shown mode WHEN the user clicks its activity item THEN `modes.show` runs with `docs`'s qualified mode id, and Docs shows.
- GIVEN Docs is the shown mode WHEN the user clicks its activity item THEN its side bar does not toggle.
- GIVEN Docs is the shown mode WHEN the user presses `<Leader>kd` THEN `docs.showMode` toggles its side bar, as today.
- GIVEN a session row WHEN the user clicks it THEN `sessions.selectRow` runs with its id, the session activates, and the side bar's overlay closes.
- GIVEN a tab WHEN the user clicks it THEN `sessions.selectTab` runs with its session and tab id.
- GIVEN a project group WHEN the user clicks its star THEN `sessions.favoriteProjectAt` runs with the project key.
- GIVEN the layout preview shows WHEN the user clicks a row THEN no command runs and the preview's selection moves. WHEN the user clicks a star THEN no command runs and the favorites do not change.
- GIVEN any added command WHEN Settings draws THEN it has no row.

Runtime checks collect in [Final verification](11-final-verification.md). This task adds none here.

## Tests

- `agent-strip.test.ts`: `click_OnBox_RunsToggleBoxAtWithSessionAndKey`, and `toggleBoxAt_OpensAndReveals`. Catches a click that skips the command, or a move that drops `revealBox`.
- `visual/page/start.test.ts`: `expandClick_RunsVisualExpandAndOpensOverlayOnSource`. Catches an expand that skips the command or opens the wrong source. `html-fence.test.ts` keeps its fake `expand` and does not change.
- `shell-chrome.test.ts`: change `activityItem_Click_ShowsItsMode` to `activityItem_Click_RunsModesShowWithItsId`, asserting the fake's `run`. Add `showMode_UnknownId_DoesNothing` and `showMode_KnownId_ShowsThroughTheHandle`. Catches a click calling the handle directly, and a mode id left unqualified.
- `sessions-view.test.ts`: `sidebarRow_Click_RunsSelectRow` and `favoriteToggle_Click_RunsFavoriteProjectAt`, each with a row in the same table. Catches a click left on the private path. The fake `runFavorite` calls `view.toggleFavorite`, so the existing star rows keep asserting the save.
- `sessions-view.test.ts`: `sidebarClick_PreviewShown_RunsNoCommand`, rows for a row click and a star click. Catches a preview click activating a real session or favoriting a real project.
- `session-tabs-view.test.ts`: `tab_Click_RunsSelectTab`. Catches a tab arg with the wrong record fields.
- `sessions-parts.test.ts`: existing favorite tests stand.
- `sessions/page/start.test.ts`: `selectRow_Handler_ActivatesAndClosesTheOverlay`. Catches the overlay staying open once the closure moves.
- `sessions/page/start.test.ts`: `selectTab_Handler_SelectsTheTabAndLogsNoShowedLine`. Catches a handler that drops the select, or a click that gains the key's `showed <tab> tab` line.
- `sessions/page/start.test.ts`: `favoriteProjectAt_Handler_TogglesTheNamedProject`, and a row for the same handler under the preview that logs `projects ignored`. Catches a handler that acts on the focused pane's project, or saves under the preview.

## Done when

The tree compiles. The layer check passes. `grep -n "handle.show()" src/renderer/shell/shell-chrome.ts` finds only `showMode`. The test gate runs the tests above, with a filtered self-test naming agent-strip, visual and sessions.

## Commit

One commit for the group.

## Proof

