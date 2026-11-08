# 11 — AGENTS.md says what landed

Status: in progress
Type: Task
Wave: 7 · Depends on: 09, 10
Plan: [plan.md](plan.md)

Files: modify `AGENTS.md`

Consumes: tasks 01-10 landed, since each line must be true when it lands.

Produces: `AGENTS.md` true for the landed hot reload, line by line.

Decisions:

- Edit each entry below to match the landed code. Read the code for each one before the edit; the plan's words are not the source. Run `wigley:writing-for-agents` on each edit, and keep the file's shape (bold lead, then the rule).
- § Intent, "**Everything hot reloads.**": the sentence `Today settings, keymap, themes and layouts hot reload and plugins are compiled in with no runtime loader` changes. Plugins now start and stop live from the `plugins.disabled` switch. A changed plugin's code still needs the runtime loader, which is the next plan.
- § Architecture, "**A plugin**": the sentences `A main part starts once; a page part starts on every page load` and the `stop(id)` sentence. Add the host's live `start`, `restart` and the dependents restart rule, the `ready()` and `mayStop()` hooks, and that quit waits for every stop and logs `quit is waiting on …` after 5 seconds.
- § Architecture, "**A disabled plugin**": it applies live now, through the switch in main, stopping page parts first and starting main parts first. Name the lock (`neededBy`), the `mayStop` refusal as a config problem, the slot clear, and the Plugins section in Settings mode.
- § Architecture, "**A slot**": a switched-off owner's slots are cleared (`clearOwner`); a restart keeps them.
- § Architecture, "**An event**": it names `core.pageReady` and `CoreEvents` as the core's own event. Change it to what task 05 landed.
- § Architecture, "**A layout**": add one sentence. The page claims the Bridge once at start, so a layout reaches the app only through its kit, and no `window.wigley` holds the Bridge. Say it is not a sandbox: a layout shares the page's DOM.
- § Architecture, "**An ambient service**" or "**A third-party tool**", whichever reads better: one sentence that a plugin cannot replace a core service. Each is built at one place in its composition root, and plugins extend it through its seams.
- The `src/preload/` line that says `the Bridge, exposed as window.wigley`: the preload now exposes only the claim, and the page claims the Bridge once.
- The `core-state.ts` line in the module map (`the core's own slots and CoreEvents`): `CoreEvents` goes with task 05.
- § Architecture, "**A slot**" ends with the list of the core's own slots: add `core.plugins`.
- The module map: add `src/preload/bridge-claim.ts`, `src/main/plugins/plugin-switch.ts`, `src/main/plugins/applied-plugins.ts`, `src/main/page-parts.ts` and `src/main/quit-wait.ts` where the map lists files at that depth; where it lists only folders, add none.
- § Architecture, "**A setting**" and "**The user config folder**": check each for text the switch made untrue.
- § Running and testing: name the plugin drive actions task 08 added, only if the drive entry lists actions by name (read it first).
- The Contents lines at the top: update the § Architecture line only if a new topic joined it.
- Check before landing. Any failure stops the task and reports a concern:
  - `grep -n "pageReady" AGENTS.md` prints nothing.
  - `grep -n "follows the list on each\|on each app start" AGENTS.md` prints nothing (today's stale line reads `A page part follows the list on each page load, a main part on each app start`).
  - `grep -n "CoreEvents" AGENTS.md` prints nothing.
  - `grep -rn "window\.wigley" src --include='*.ts' --include='*.js'` prints only the claim in `src/renderer/renderer.ts` and the comment on `Bridge` in `src/contracts/bridge.ts`.

GIVEN an agent reads `AGENTS.md` WHEN it adds a page part that needs its siblings started THEN the "A plugin" entry tells it to use `ready()`.

Tests: none. This is a doc change, and the greps above are diff-visible.

Done when: every entry listed is true against the code; the greps above hold.
Commit: one commit for the group.

## Proof
