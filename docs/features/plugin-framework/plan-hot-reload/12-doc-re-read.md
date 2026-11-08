# 12 — Doc re-read

Status: done
Type: Task
Wave: 8 · Depends on: 11
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/plugin-framework/design.md` · `docs/features/intent-alignment/master-plan.md` · `docs/features/followups.md`
- modify `docs/features/chat-bar/design.md` (§ Optional plugins)
- modify `docs/features/layouts/design.md` · `docs/features/settings/design.md` · `docs/features/session-host/design.md` · `.agents/skills/drive/SKILL.md` only when a re-read finds a stale line

Consumes: tasks 01-11 landed.

Produces: each doc below true against the landed code, line by line, and the stale lines fixed.

Decisions:

Re-read each section against the code. Fix each stale line. Run `wigley:writing-for-agents` on each edit.

- `docs/features/plugin-framework/design.md` § Hot reload (Wave 4), each bullet. It was written before the code. Check in particular:
  - "The raw bridge is closed": the claim's name and its error text as task 01 landed them.
  - "`ready()` replaces `core.pageReady`" and "`mayStop()` refuses…": the hook names and when the host calls each.
  - "The switch runs in main": the stop and start order, and how a `mayStop` refusal reaches the user (a config problem).
  - "Settings has a Plugins section": the copy and the lock text as task 09 landed them, and what became of the raw `plugins.disabled` row.
  - "Quit waits for every stop to settle": the log line `quit is waiting on …`.
  - Remove the plan folder name `plan-hot-reload/` from the section's first paragraph, since the folder is deleted at close.
- `docs/features/plugin-framework/design.md` § Foundation sweeps: the bullet "Stop now, reload later" says reload and the live enable switch stay in Wave 4. Make it true.
- `docs/features/plugin-framework/design.md` § Commands and state: the bullet "A slot outlives its owner's stop" ends `Clearing a slot for a plugin switched off live falls to Wave 4.` Make it true.
- `docs/features/plugin-framework/design.md` line 49 (`starts at launch unless the core setting plugins.disabled names it`): add that the list also applies live, through the switch. Reword the § Hot reload bullet title `ready() replaces core.pageReady` to `ready() replaces the page-ready event`.
- `docs/features/chat-bar/design.md` § Optional plugins: it says a switch-off applies on the next page load or app start, that a switch-on needs a restart, and that the page reads the union of the setting and main's start list. Rewrite each to the live switch: the list applies at once, through the switch in main, and the page runs what main's applied list says.
- `grep -rn "pageReady" docs .agents --exclude-dir=plan-hot-reload`: fix each hit.
- `grep -rln "plugins.disabled" docs .agents`: re-read each hit for "next page load", "next app start" or a frozen list.
- `docs/features/session-host/design.md`: check what it says about chat's stop at quit. Chat now also stops live, with the same detach. Fix a line that says only quit does it.

Master plan and follow-ups (`master-plan.md` § Intent: tick the box and remove the item, in the same commit):

- Tick in `master-plan.md` § Wave 4: `Layout access to the raw bridge`, `Replaceable core services decision`, `PluginHost stop and reload, with a live enable switch`. Leave `Runtime plugin loader` open.
- In `master-plan.md` § Intent, change the "Plans:" paragraph: Wave 4 steps 1 and 2 have landed and their plan folder is gone; the runtime loader needs its own plan.
- Remove these items from `docs/features/followups.md`. Find each by its bold name and remove the whole bullet. First check that every clause of the bullet landed. A clause that did not land stays as its own follow-up, and the report names it:
  - `PluginHost stop and reload, with a live enable switch`: its `reload(id, part)` clause (a reload with new code) did not land. Move it by name into the `Runtime plugin loader` item, then remove this one.
  - `Parts that follow at core.pageReady follow nothing after a part restart`
  - `Quit does not hold for a plugin's suspending dispose`: its "prove it in a live quit" clause is a user check, which goes in the run's wrap-up and nowhere else, so it does not keep the item.
  - `Layout access to the raw bridge`
  - `Replaceable core services decision`
- Read the item `A quit can lose a session's open run time`. Remove it when the live `runQuitTasks` now holds until chat's `detachAll` settles (read main.ts); otherwise keep it and fix its pointer to the removed quit item.
- Edit the `Runtime plugin loader` item: it now builds on a host that starts, stops and restarts live, and on the closed bridge. Keep the rest of it.
- Grep `followups.md` and `master-plan.md` for text that points at the removed items. Fix each line that is now untrue.
- Each limit a task's Proof names as left out becomes a follow-up in the file's shape.

GIVEN the five items landed WHEN `grep -c 'PluginHost stop and reload\|Parts that follow at\|Quit does not hold\|Layout access to the raw bridge\|Replaceable core services decision' docs/features/followups.md` runs THEN it prints 0.
GIVEN `master-plan.md` § Wave 4 WHEN it is read THEN every box is ticked except `Runtime plugin loader`.
GIVEN the docs WHEN `grep -rn "pageReady" docs .agents AGENTS.md --exclude-dir=plan-hot-reload` runs THEN it prints nothing.

Tests: none. This is a doc change, and the greps above are diff-visible.

Done when: each doc listed is re-read and true; the greps above hold; § Hot reload (Wave 4) carries no text that still reads as a plan.
Commit: one commit for the group.

## Proof

Commit 9aef9ed7 · proof: diff read: each listed doc edited, followups items removed/added; the task's three greps hold (pageReady grep excludes plan-command-consumers, Wave 3's folder); lint clean · concerns: session-clock/design.md fixed outside the file list; the Plugins row shows true/false (not on/off) and the docs say so; no followup for mainStartList (still used) or the repeated config-applied log line
