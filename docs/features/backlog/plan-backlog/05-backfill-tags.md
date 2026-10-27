# 05 — Backfill agent-ready tags

Status: in progress
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify each open follow-ups file in the homes below (re-list first: `ls -d ~/Documents/ai-dev/*/docs/features
           ~/wigley-features/*/`, then each home's `followups.md` and `followups/*.md`, leaving out `followups/README.md`, which is an index
           of the folder, not follow-ups). At plan time:
           - `~/Documents/ai-dev/wigley-agents/docs/features/followups.md`
           - `~/Documents/ai-dev/wigley-ai-gui/docs/features/followups.md` (list-shaped)
           - `~/Documents/ai-dev/wigley-ai-marketplace/docs/features/followups.md` and `followups/*.md`, when present
           - `~/Documents/ai-dev/wigley-harness/docs/features/followups.md` and `followups/*.md`, when present
           - `~/wigley-features/new-games-prototypes/followups.md`
Consumes:  the criteria and line shape in wigley-ai-marketplace `plugins/wigley/skills/review/triage.md` § The
           project's follow-ups (committed `9b8dbe1`)
Produces:  each open item that meets the `agent-ready` criteria carries `*agent-ready*:` on its Contents line or list
           item; every other line unchanged
Decisions: one agent pass tags the existing items, and the user adjusts them in Backlog afterwards (round 1) · these
           files are all personal (decisions.md § Personal and team files), so the edits need no ask · skip a done
           item (struck through, or one line starting `shipped`) · an item already tagged `needs a feature plan` is
           never also `agent-ready` · a repo's `docs/followups/*.md` is out of scope (design.md § Scope)

## How to judge each item

Read the whole section or list item. Tag it `agent-ready` when it is a bug fix or task with no design decision left
in it, or every design decision it needs is already stated as settled and only the work was put off. Leave it
untagged when it lists open questions, offers options without a choice, says "decide", "design", "spike" or "plan
it", or needs work outside code (art, remote config, console setup, another team).

## How to write the tag

- Section-shaped file: edit only the item's Contents line, to `- **<title>** — *agent-ready*: <one line>`.
- List-shaped file: edit only the item's first line, keeping its marker (`- ` or `N. `). An item titled by its
  first sentence takes the bold-lead form: `- Command palette.` becomes `- **Command palette** — *agent-ready*:
  <rest of the first line, if any>`. A colon-form line `- **Title**: gist` becomes `- **Title** — *agent-ready*:
  gist`.
- An item that already has a tag span adds `agent-ready` to it, comma-separated.

GIVEN `- **Silent reward popup** — the framework's PurchaseSuccessView plays no sound…` (a bug with a known fix) WHEN
judged THEN it is tagged. GIVEN `Pluggable Home prompt queue`, whose section lists Open questions, WHEN judged THEN it is
not tagged.

Tests:     none: no logic lands. Verification is the diff.
Done when: every open item in every listed file was judged; `git diff` in each in-repo home shows only Contents-line or
           first-line changes; the report lists each file with the titles tagged and the count left untagged.
Commit:    one commit per in-repo home that changed, message `Follow-ups: agent-ready tags on items with no open
           design decision`, staging only that home's follow-up files. `~/wigley-features/` is not in git: report its
           changes instead.

## Proof
