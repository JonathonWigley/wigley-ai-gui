# 14 — Final verification

Status: not started
Type: Task
Wave: 10 · Depends on: 13
Plan: [plan.md](plan.md)

Files: no source file changes. A check that finds a bug goes back through a fix dispatch, as `wigley:make` says. Scratch goes in the session scratchpad, and drive output stays in `.drive/`.

Consumes: every task's landed code, 01 to 13.

Produces: the report below, in this task's Proof, with each check's result and its evidence (log line, screenshot name or query output).

Decisions:

- Read `.agents/skills/drive/SKILL.md` before the first drive command, and `npm run drive -- help` for the exact commands. Every Node command runs under `source ~/.nvm/nvm.sh && nvm use && …`.
- Pass `--run <id>` on every drive command, since a peer's run may be live.
- This task lists only what `wigley:writing-tests` § What earns a live run instead admits. Whatever a test or a self-test step pins is left off.
- The whole self-test does not run unless the user asks for it in the current turn. A filtered run skips the end-of-run placement check, and the Proof says so. Task 12 lists each bind's anchor and state for the whole run the user may ask for.
- Each drive run works on its own home. No check writes to `~/wigley-agents` or to the user's index.

**Filtered self-test.** Run once: `npm run selftest -- --plugin docs,backlog`. Backlog reads docs' index, and schema 5 changes that index. Tag: **expected**.

**Drive checks.**

| # | Check | Tag | Why it needs a live run |
|---|---|---|---|
| 1 | Run the worktree's real `docs_index.py` (wigley-ai-marketplace) over a drive home that holds a `Main.md` and the check-3 doc, not through the fixture's stand-in. Setup in § The real script. The app loads the index with no schema error. `Main.md` shows and the sidebar builds shelves from it. `screenshot`. | low-confidence | The self-test's stand-in writes the schema by hand. Only this run meets the real script and the real parser across the two repos. |
| 2 | Click the `sidebarSwitch` control twice. `wait-log` shows `[docs] sidebar shows All pages`, then `[docs] sidebar shows the wiki`. | expected | The self-test presses keys only, and task 12 pins only the wire. |
| 3 | Home: check 1's home, with the real script's index. Doc: the check-1 guide, whose text holds `` `decisions.md` § Asking `` and a `` `target.md` § Target part `` split across a line wrap. Click a § link with the mouse. The page moves to the target heading. `Ctrl+o` returns. | expected | A real click on a real mounted body. |
| 4 | Home: its own drive run on the fixture (`docs.seed`), with the stand-in index. Doc: `guide.md` (`WIKI_GUIDE_FILE`). Edit `Middle notes`, and `:w`. Read the file: only that section changed, and the rest of the bytes match. | expected | Real editor and real write, across the page and main. |
| 5 | Home: check 4's. Doc: `guide.md`. Narrow the window to below the aside's width, then widen. The right column hides before the article gives up width, and comes back. `screenshot` at both widths, and read each against `DESIGN.md`. | expected | Layout, measured only on a real page. |
| 6 | Home: check 4's fixture home, with the stand-in index. Doc: `Main.md` (`WIKI_MAIN_FILE`). Its `Commit page` link is `dev/backlog-repo`'s `plan.md`, which has one commit. Before reading, append a line to that `plan.md` and commit it with a drive-side `git -C <home>/dev/backlog-repo commit`, so two commits show. Read Recent changes: two rows, each with a time, a subject and the `Commit page` link. `screenshot`, and read it against `DESIGN.md`. | expected | Real `git` through the adapter. |

**The real script.** `docs.seed` writes a stand-in `docs_index.py` under `<home>/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index/` and an `installed_plugins.json` that points at it. The stand-in never reads `HOME`. The real script does.

1. `start --run <id>` for check 1 alone, and `docs.seed` once. Do not call `docs.seed` again in this run, and do not `restart` it: both rewrite the fixture and the stand-in comes back.
2. Copy the worktree's `wigley-ai-marketplace/plugins/wigley/scripts/docs-index/` over that `scripts/docs-index/` folder, and leave `installed_plugins.json` as it is.
3. Write the check-1 guide and a `Main.md` into the run's `<home>`: copies of the fixture's `WIKI_GUIDE_TEXT` with `` `decisions.md` § Asking `` added, and `WIKI_MAIN_TEXT`. Put `Main.md` where the app reads it (`<home>/wigley-agents/wiki/Main.md`), never in `~/wigley-agents`.
4. Run `R`. The real script then runs with the run's `HOME` set (the drive start sets it), so it reads the drive home and not the user's.
5. Prove the real script ran: `query` the index file the app reads (in `<home>`, read-only), and check `schemaVersion` is 5, the `Main.md` entry holds `headings` of its `##` lines, and the guide's entry holds `links` with `form: 'section'`. The stand-in writes the hand-written values of `index.fixture.json`; these come only from the real parser.
6. Run checks 1 and 3 on this one run, then `quit`.

Each other check runs on its own `start --run <id>` and home. No check writes to `~/wigley-agents` or the user's index.

**Report.** In the Proof, give one line per check and the self-test's result. The wrap-up, not this task, lists the checks only the user can run: `Ctrl+i` and `Ctrl+o` on a real keyboard in a visible `npm start`.

The stable app reads the index the marketplace script writes, so it needs schema 5 in both. `wigley:make`'s wrap-up tells the user that a landed marketplace plugin update and an app install go together, because the schema has no fallback.

GIVEN the landed code WHEN the checks above run THEN each passes, with its evidence in the Proof.

Tests: none added.

Done when: each check above has a result and evidence in the Proof.

Commit: none, unless a fix lands through a dispatch.

## Proof

