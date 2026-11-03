# 13 — Doc re-read, and the master plan and follow-ups closed

Status: done
Type: Task
Wave: 8 · Depends on: 11, 12
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `docs/features/plugin-framework/design.md` · modify `docs/features/intent-alignment/master-plan.md` · modify `docs/features/followups.md`
Consumes:  the landed code of tasks 01–12
Produces:  no code
Decisions: a stale doc line is fixed to match the landed code, and the fix is named in the commit (`~/wigley-agents/AGENTS.md` § Workflow) · the master plan's rule: when an item lands, tick its box and remove it from `followups.md` in the same commit (`master-plan.md` § Intent)

Steps:

1. Read each doc written ahead (commit `d7200571`) line by line against the landed code:
   - `AGENTS.md` § Architecture: the "A plugin", "A registration", "A plugin talks", "An MCP tool" and "An ambient
     service" entries, and the `npm run lint` layer check entry. Check each name it gives (`exports(consumer)`,
     `consumer.track`, `stop(id)`, `DependencyKey`, `sessionsMainKey`, `keysPageKey`, `dependsOn.main`,
     `dependsOn.page`, `PLUGIN_EXTRAS`) with a grep in `src/` or `scripts/` (`PLUGIN_EXTRAS` lives in
     `scripts/layer-rules.mts` or `scripts/check-layers.mts` once task 12 lands; if task 12 named it otherwise, fix
     the `AGENTS.md` line to the landed name). `stop(id)` is checked with `grep -n "stop(pluginId" src/shared/plugin-host.ts`,
     and `log(message)` with `grep -rnE "log\('[a-z-]+'," src/plugins` printing nothing.
   - `docs/features/plugin-framework/design.md` § Foundation sweeps (Wave 1).
2. Task 12 widened some layer rules: `src/shared/paths` and `src/shared/followups` are allowed in every plugin root,
   `main` and `page`, the four page kits in every `page`, and the `forms` and `primer` `contract.ts` files are their
   own layers. Make sure the `npm run lint` layer check entry in `AGENTS.md` says so in one line, read against
   `scripts/layer-rules.mts`.
3. Fix every line that the code contradicts. Read the rest of `AGENTS.md` § Architecture for lines that the plan made
   stale (for example an entry that still says `api.dependency<…>('id')`, `remove()` on a tab handle, `logSource`,
   or "exports read as `undefined`"), and fix them too.
4. In `docs/features/intent-alignment/master-plan.md` § Wave 1, tick the five boxes: Disposable registrations,
   Typed dependency keys, Disposable tool contributions, Plugin-scoped logs, Derived layer rules. Leave the wave's
   gate line and heading as they are: the ticks are the record.
5. In `docs/features/followups.md`, remove the five items with those titles wherever they sit (at plan time three
   under § Foundations, `Plugin-scoped logs` under § Bugs seen in use, `Derived layer rules` under § Plugin extension
   points; re-verify with a grep of each title). Find every item that cites one of them (grep "Builds on" and each
   title; at plan time "Builds on the disposable registrations above", "Forms item kinds as registrations … needs
   this", "Builds on PluginHost stop and reload") and change the citation to "<title> landed (plan-foundation-sweeps)". The PluginHost
   item keeps `reload(id)`, the live enable switch and the stable export proxy, and drops `stop(id)` and the
   reverse-order quit.
6. Add to `followups.md` each follow-up the run's Run log or review recorded that has no home yet, in that file's
   shape (its header says how).

Done when: every name in step 1 greps to the landed code; the five boxes are ticked and the five items are gone;
`npm run lint` passes (`check-styles` and `oxfmt` cover nothing here, so the doc edits need only the grep checks).
Commit:    one commit for the group, naming each stale line fixed

## Proof

Commit 8740cc31 · proof: Doc diff read; every step 1 name greps to the landed code; five boxes ticked, five items gone; whole-tree lint clean (1030 layer, 695 style files) · concerns: Sites in the throwing-teardown follow-up come from the Run log and were not checked one by one: its tool-session path is approximate, and 'leaves the end-wait resolved' reads wrongly. Run-log doubts left out of the follow-ups are listed in the worker's report.
