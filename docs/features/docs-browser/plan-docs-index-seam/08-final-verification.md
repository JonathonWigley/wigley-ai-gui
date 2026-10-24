# 08 — Final verification in drive runs

Status: in progress
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none (drive runs, the self-test, one script run)
Consumes:  every task
Produces:  a live-check record in the Proof section
Decisions: only checks no test pins (`wigley:writing-tests` § What earns a live run instead). Every run happens with
           no `npm start` of the user's open, since it shares `.vite/build` and is outside the start lock. Read
           `.agents/skills/drive/SKILL.md` first.

## Checks

Run each one and read every capture. Each is tagged expected (the change doing its job) or low-confidence (where a
bug is likely), with its reason.

1. **Self-test** — expected; it carries the changed log lines. `npm run selftest`. Pass: `[selftest] all passed`,
   with `[docs] machine index rebuilt: 8 entries` and `[docs] session index read: 4 entries` among the waited lines.
2. **Docs mode's first show** — low-confidence; the machine read moved from creation to the first show, and no test
   covers the page. In a fresh dev run, press `Space k d` and screenshot at once and again after the
   `machine index read` log line. Pass: the side bar shows `Reading the docs index…` or the tree, never an empty pane
   with no line, then `Rebuilding the docs index…` above the tree, matching `DESIGN.md`'s status-line rule.
3. **Session Docs tab through `addView`** — low-confidence; the tab's wiring moved into `addView`.
   `docs.connectSession`, then screenshot the tab, press `Space v t` twice (screenshot each), and drag the split
   handle (`drag --hold` / `release`, as in the drive skill). Pass: the tab looks as it did before (tree left, doc
   right); the tree hides and shows; the width changes and is kept when the tab shows again after `<A-S-o>` and back.
4. **`openDoc`** — expected; nothing calls it yet but the drive action. In a fresh dev run, before Docs mode has
   shown, run `docs.openDoc` with a fixture doc's path the machine index lists and `line` past the first screen.
   Pass: Docs mode shows, the doc opens scrolled to that line, and its tree row is selected. Then run it with
   `/tmp/not-indexed.md`. Pass: the toast reads `Not an indexed doc: /tmp/not-indexed.md`.
5. **Trash of a walked link** — low-confidence; the dialog's text over three paths and the link removal have no
   live run. In a dev run's temp home, before Docs mode shows:
   - make a skill folder inside the fixture repo with a `SKILL.md`
   - link `<home>/.claude/skills/<name>` to it
   - add that entry, with `walked: ["<home>/.claude/skills/<name>/SKILL.md"]`, to `<home>/.agents/wigley-docs/index.json`
     and to the stand-in script's `index.fixture.json` (under the temp home's
     `.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/`), since the first show's rebuild
     rewrites `index.json` from it

   Show Docs mode, select the skill, and press `d`. Screenshot the prompt, then press `y`. Pass: the prompt names
   the folder and the link by tilde paths and fits the dialog; afterwards `command ls -la` shows neither the folder
   nor the link.
6. **Real script output** — expected; schema 2 crosses repos. Run
   `python3 -X utf8 <marketplace>/plugins/wigley/scripts/docs-index/docs_index.py context <this repo>`. It writes
   nothing; never run `build`, which rewrites the user's own index. Feed its stdout to `python3 -c` that loads the
   JSON and prints `schemaVersion` and the number of entries lacking a `walked` list. Pass: `2` and `0`.

Done when: every check above ran and its result, with capture paths, is recorded in Proof; a failed check is
           reported to the lead with its capture
Commit:    none; `wigley:make` records the Proof

## Proof
