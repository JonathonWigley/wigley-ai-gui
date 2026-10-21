# 10 — Doc re-read

Status: done
Type: Task
Wave: 7 · Depends on: 09
Plan: [plan.md](plan.md)

Each doc written ahead of plan B's code is a hypothesis until the code lands. Read each line below against the landed
code, fix every stale line, and commit the fixes. A line that still holds is left as it is. Wording follows
`wigley:writing-for-agents` (load it before editing) and the repo's existing voice.

Files:
- modify (when stale) `~/Documents/dev/wigley-ai-gui/AGENTS.md`
- modify (when stale) `~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/README.md`
- modify (when stale) `docs/features/docs-browser/design.md`
- modify `docs/features/followups.md`

Consumes: the landed code of tasks 01–09.

Produces: no code. Fixed docs, committed per repo.

## Decisions

**wigley-ai-gui `AGENTS.md`** — plan B owns these lines (plan.md § Docs written ahead, commit `80f9941`); plan A's
re-read owns the mode, session-tab, sidebar and scoped-editor-key lines. Check each against the code:

1. The intro's docs sentence ("browses and edits every agent doc on the machine through the docs index …").
2. The layout tree lines `files/`, `processes/` (under `src/main/`), `codemirror-vim/` (editor and code-highlight
   adapters, the package list `codemirror, @codemirror, @lezer and @replit`), and `docs/` (main: index runs, file
   changes inside the indexed folders only, watching the open file; page: one docs view shown as Docs mode and as each
   session's Docs tab).
3. **An ambient service**: the list "the clock, ids, the home folder, files (with watching), processes". Task 06 added
   `MainServices.openExternal`; add it to the list ("opening a link in the default browser") so the line names every
   main service a plugin gets.
4. **A third-party tool**: "the core hands plugins the shared ones (editor, markdown) as services" — task 02 keeps the
   highlighter inside the markdown adapter and the editor host (`PageServices` is unchanged), so the line holds; add
   "code highlighter" to the parenthesis only when the landed code puts it on `PageServices`.
5. **Running and testing**, the self-test paragraph: each plugin hands one script (it names forms' and chat's). Add one
   sentence: the docs plugin hands its own, `src/plugins/docs/main/selftest-script.ts`, whose fixture
   `src/plugins/docs/main/selftest-fixture.ts` writes docs, an index and a stand-in `docs_index.py` into the self-test's
   temp home at start, so the docs steps never reach the user's docs or index.
6. **A session tab**: agent chat plan A's re-read is closed and left the clause "and the docs plugin, once it lands, a
   Docs tab when the session connects". With the docs plugin landed, it reads "and docs a Docs tab to each session when
   it connects".
7. **A key**: if any docs key behaviour the code landed contradicts it (for example a text box that keeps typed keys
   from the page keys, task 08), add the rule the code follows.

Commit in wigley-ai-gui: "AGENTS.md: docs plugin lines re-read against the landed code" (only when a line changed).

**docs-index `README.md`** (commit `44bf63a`, landed by task 03):

1. § Config: the `claudeConfigDirs` bullet — default `["~/.claude"]`, each folder indexed as part of the global layer,
   `build` and `context` judge against the first folder, `session` searches every folder's `projects/`, an empty or
   wrong-shaped list takes the default. Check the empty-list stderr line task 03 added and name it if the README's
   other keys name theirs.
2. § Commands, the `session <id>` bullet: the transcript `<dir>/projects/*/<id>.jsonl` in the first folder holding it.
3. The JSON example in § Config holds `claudeConfigDirs`.

Commit in wigley-ai-marketplace on `main` (its `AGENTS.md`: commit straight to `main`): "docs-index README:
claudeConfigDirs lines re-read against the landed code" (only when a line changed). No push: the user pushes.

**`design.md`** (outside any repo): read § Docs browser and § Core services and seams against the landed code. Fix a
line only where the code shows it wrong (a settled decision the code had to change, with the run log's ruling as the
reason); a decision the code still honours stays. No commit (no repo).

**`followups.md`** (`docs/features/followups.md`): remove the line
`- Syntax-highlighting theme tokens.` — task 02 landed the `syntax.*` tokens (plan.md Decisions, Code highlighting).
In the line `- An active-line band in the editors (needs the `@codemirror/view` dependency).`, drop the parenthesis:
`@codemirror/view` is now a declared dependency. No commit (no repo).

## GIVEN / WHEN / THEN

- GIVEN the landed `MainServices` WHEN **An ambient service** is read THEN it names every service a plugin gets, `openExternal` included.
- GIVEN task 02 landed the theme tokens WHEN `followups.md` is read THEN the syntax-highlighting line is gone.

## Tests

None: docs only.

## Done when

Every line listed above read against the code; stale lines fixed; the wigley-ai-gui and wigley-ai-marketplace fixes
committed (one commit per repo, only when that repo changed); the follow-up removed. The report lists each line
changed, and each line checked and left.

## Commit

One commit per repo that changed, messages above. Nothing is pushed.

## Proof

`1939b4f` · lines changed and left in plan.md's Run log.
