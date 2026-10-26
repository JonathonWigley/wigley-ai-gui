# 10 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 09
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui (reads wigley-ai-marketplace's clone)

Files:     none changed; captures under the drive run's folder and the session scratchpad
Consumes:  everything 01–09 landed
Produces:  the verification report in the Proof section
Decisions: the app normally runs the installed `docs_index.py`, which stays on schema 3 until the user pushes and
           updates the plugin, so the live checks run the clone's script (`docs.scriptPath`). The user's own settings
           file is not edited: the drive run sets `docs.scriptPath` in its own config (AGENTS.md § Running and
           testing). `build` writes `~/.agents/wigley-docs/index.json` and `~/.agents/wigley-docs/loads.json`. Both
           are app-written cache data that the next build rewrites, so running it is not a destructive step
Approach:  run in this order; each check is tagged expected or low-confidence with its reason

1. **Real index, cold and warm** (low-confidence: the cache and the byte prefilter meet 6.9 GB of real transcripts
   for the first time; unit tests use small built transcripts). Confirm `~/.agents/wigley-docs/loads.json` is
   absent first (it is absent at plan time; if a run already wrote it, say so). Run
   `python3 -X utf8 <marketplace clone>/plugins/wigley/scripts/docs-index/docs_index.py build --stdout` into a
   scratch file, timed. Run it a second time, timed. Report both durations. Expect the second run to take about the
   time of a schema 3 build (12.7 s measured 2026-10-19, re-verify) and the first to take about 17 s more. Check
   with a short Python reading of the output:
   - `schemaVersion` is 4, and every entry has a `lastLoaded` key.
   - The clone's `plugins/wigley/skills/feature/SKILL.md` entry has a `lastLoaded` on 2026-10-26 or later (this
     plan's interview loaded the skill from its installed copy, which is merged into the clone entry).
   - `~/wigley-agents/AGENTS.md` has a `lastLoaded` within the last day (every session loads it at launch).
   - A third-party synced skill nobody ran has `lastLoaded` null (spot-check one with `command grep -a -l` over the
     transcripts for its name returning nothing).
   - Report the count of entries with a time and without, per kind.
2. **Session times** (expected: task 02's tests pin the rule; this proves it on a real transcript). Run
   `docs_index.py session 1c961b7b-5f8b-4dcd-a962-fde329997c2b` (the planning session). The clone's
   `skills/feature/SKILL.md` has a time on 2026-10-26. `~/.claude-personal/plugins/cache/wigley-ai-marketplace/
   wigley/1.10.2/skills/feature/plan-folder.md` (a skill file this session read) has a time, when the index lists it.
   A doc the session never touched, such as `docs/features/agent-chat/design.md` of wigley-ai-gui, has null.
3. **Self-test** (expected): `npm run selftest` passes, task 08's steps included.
4. **Docs view look and keys** (low-confidence: new row parts, the star mark and the doc view line are visual, and
   no test sees them). Start a drive run (`drive` skill) with no `docs.scriptPath`: the run seeds the docs
   fixture and its stand-in script into its temp home, and the fixture carries times after tasks 04 and 08 (the
   clone's real script over a temp home with no transcripts would give every doc a null time). Checks 1 and 2
   already prove the real script and the order end to end. Capture:
   - Rules: `Style` with its time dimmed at the row end, above the never-loaded `neat.md`;
   - the hover text of one row (query its `title` attribute): `Last loaded <date, time>`;
   - `s` on a doc row: the Starred group above Mine with the doc, the filled star on both rows; `s` on the Starred
     row again: the group is gone;
   - `/` with a filter that matches the starred doc: the Starred group still shows it;
   - the doc view of a doc with a time: `Loaded … ago` beside the load chips; a doc with no time: no line.
   Check each capture against DESIGN.md (tokens, the muted text tone, the icon size and alignment). Fix what fails
   and say so in the report.
5. **Stars survive a reload** (low-confidence: `uiState` writes and the page reload meet for the first time). In the
   same drive run, star a doc, reload the page (the drive run's reload command, or quit and `start --run <id>`
   again on the same home), and capture the Starred group still holding it.

Done when: every check above passes or its failure is fixed and re-run; the report lists each check, its result and
           the capture paths
Commit:    none, unless a fix was needed (then one commit per fix, in its repo, by path only)

## Proof
