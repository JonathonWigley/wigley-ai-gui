# 15 — Doc re-read

Status: not started
Type: Task
Wave: 7 · Depends on: 14
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · `DESIGN.md` · `docs/features/settings/design.md` ·
           `docs/features/plugin-framework/design.md` · `docs/features/followups.md` ·
           `docs/features/intent-alignment/master-plan.md` · `src/plugins/settings/page/settings-view.ts` (two comments) ·
           any other doc the re-read finds stale
Consumes:  the landed code of tasks 01–14; the doc hand-offs of tasks 04, 05, 06 (follow-up items), 07 (the `@import`
           lines), 08 (the revision-folder follow-up) and 12 (the Plugins row look)
Produces:  docs that match the landed code; the follow-ups file without the four items this plan closed, and with two new items
Decisions: docs written ahead are hypotheses (`wigley:writing-for-agents` § Doctrine before code) · follow-up items
           leave the file when their work lands (the file's own rule) · this task owns the stale code comments that no
           other task owns (step 3)

Steps:

1. Read each doc written ahead line by line against the landed code. The docs are listed in plan.md § Docs written
   ahead. Fix each line that the code contradicts. Check every path, name, folder, scheme, command id, setting and
   order the docs state.
2. Read the AGENTS.md lines that the plan's code changed and the docs written ahead did not touch. Check at least:
   the code tree block (new `src/main/plugin-catalog/`, `src/shared/plugin-catalog/`, `src/shared/plugin-url.ts`,
   `src/contracts/plugin-catalog.ts`), the "A disabled plugin" bullet (the switch over the catalog), the "A slot"
   bullet (`core.plugins` covers every catalog plugin), the "Plugin data" bullet (the `wigley-plugin:` scheme beside
   `wigley-data:`), the "A layout" bullet (a user plugin's default layout, and the show's `draw` as the way a page part draws through its layout kit), and the layer-check bullet (the two new
   core layers). Add each fact the code cannot show; drop each fact the code now shows better.
3. Run this grep, and fix each hit that is not an expected survivor:
   `grep -rn "focusedEntry\|ChatPageExports.*focused\|focusedBlock\|built-in manifests list\|Every built-in plugin" AGENTS.md DESIGN.md docs src --include=*.md --include=*.ts | grep -v "plan-runtime-loader"`
   - Expected survivors (each is still true, leave it): `src/plugins/main.ts`, `src/plugins/page.ts` and
     `src/plugins/manifests.ts` ("Every built-in plugin's …": those lists hold built-ins only);
     `docs/features/plugin-framework/design.md` (the line "Every built-in plugin starts at launch unless …");
     `src/shared/plugin-manifests.ts` (`requireListed`'s message, which the built-in source still uses).
   - Owned by this task: the two comments in `src/plugins/settings/page/settings-view.ts` that read "Every built-in
     plugin as the plugin switch last wrote it" (lines 183 and 232 at plan time). Change each to "Every plugin row as
     the plugin switch last wrote it: each catalog plugin, then each plugin that failed its first load."
   - Owned by other tasks, so a hit here is a finding to report, not to fix: `src/renderer/renderer.ts`
     (`requireServedSettings`, task 11), `src/contracts/core-state.ts` (`corePluginsSlot`, task 10), and any
     `focusedEntry` or `focusedBlock` (task 06).
   - A hit in another code file is a stale comment: fix it in this task's commit.
4. In `docs/features/followups.md`, remove these three items, whose work landed in tasks 04, 05 and 06:
   "A page part started live gets no restore window", "A restart leaves a page part's keys with no handler",
   "Visual reads chat's focused entry through a slot". Remove the "Runtime plugin loader" item.
5. Add two items to the Foundations section of `docs/features/followups.md`, below the items it builds on:
   **Built-in plugin hot reload** — *needs a feature plan*: built-ins still need a rebuild to change. Reloading one
   with new code compiles TypeScript inside the running app, so a compiler ships with it (a third-party ask). The
   runtime loader's `PluginSource` seam and `reload` are the base: a third source over the repo clone.
   Add a second item: **Old plugin code revisions stay on disk** — *agent-ready*: each load copies a user plugin
   into `<userData>/plugin-code/<id>/<rev>/` (task 08), and no step deletes old revision folders. Name the rule a
   cleanup would follow: keep the revisions the running process imported.
6. In `docs/features/intent-alignment/master-plan.md`, tick Wave 4 step 3, and change the Plans paragraph to say the
   loader landed and its plan folder is gone.
7. In `docs/features/plugin-framework/design.md` § Runtime loader, change "Plan folder `plan-runtime-loader/`." to
   say the loader landed.
8. Write the Plugins row look that task 12 landed into `DESIGN.md` (§ Surfaces, the "Settings" bullet, its "A Plugins
   row ends in the plugin's state" sentence) and into `docs/features/settings/design.md` § Plugins section. Read the
   landed `layout.js` and `plugin-rows.ts` first, and write what they draw:
   - The row's end holds, in this order: an error Tag `failed` (only when the row has a problem), a neutral origin Tag
     (`user` or `replaces built-in`; none for a built-in), the lock Tag as today, then the value.
   - The problem shows as a `status-error` line under the description, wrapped whole.
   - The value `true`/`false` shows whether a version of the plugin runs.
   - A plugin that failed its first load gets a row labelled with its id and no description.
   - In `docs/features/settings/design.md`, also change "One row per plugin, in manifest order" to "One row per
     plugin, in catalog order, then each plugin that failed its first load".
9. In the AGENTS.md bullet "A user plugin" (about line 440 at plan time), add the four example lines that task 07 put
   in the doc comment over `writePluginTypes`, if the bullet does not hold them yet. Copy them from the landed doc
   comment. At plan time they are:
   - `/** @import { UserMainApi, UserMainStart } from '../_types/plugin' */`
   - `/** @import { ChatMainExports } from '../_types/plugins/chat/contract' */`
   - `/** @import { PluginManifest } from '../_types/contracts/plugin' */`
   - `manifest.json`: `"$schema": "../_types/manifest.schema.json"`

Done when: each doc line names only what the code does; the grep in step 3 prints only the expected survivors that
step 3 lists; the follow-ups file holds the two new items and not the four removed ones; `DESIGN.md` and
`docs/features/settings/design.md` name the `failed` and origin Tags and the problem line; `grep -c "_types/plugin'" AGENTS.md`
prints at least `1`.
Commit:    one commit: "Docs match the landed runtime plugin loader".

## Proof
