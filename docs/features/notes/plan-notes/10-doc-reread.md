# 10 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09
Plan: [plan.md](plan.md)

Files:     each doc written ahead, re-read line by line against the landed code:
           - wigley-ai-gui `docs/features/notes/design.md`
           - wigley-ai-gui `AGENTS.md` (the `fabric/`, `backlog/` and `notes/` lines)
           - wigley-ai-gui `docs/keymap.md` (the `n` row)
           - wigley-ai-gui `docs/features/backlog/design.md` (the images bullet under Follow-ups, the Commit bullet
             under Git, the exports bullet under Seams)
           - wigley-ai-marketplace `plugins/wigley/skills/review/triage.md` § The project's follow-ups (the image
             and source-session bullets)
Consumes:  every landed commit of this plan
Produces:  each stale line fixed
Decisions: a doc written before its code is a hypothesis (decisions.md § Docs; writing-for-agents § Doctrine before
           code) · fix in place; personal repos, so each fix goes in as Decided

Check in particular:

- the image folder name and link text against task 05's `fileNote`
- the Commit message format in `docs/features/backlog/design.md` § Git against task 05's `commitMessage`, which
  gains an images part
- the session line text against task 06
- the `launchBrief` default text and the profile rule against task 07
- the field list, the keys and the capture sequence against task 08
- the `window.capture` and markup seam wording against tasks 01 and 02
- `AGENTS.md`'s main service list: add `capture` where the `window` service is described, if a line describes it

Tests:     none: docs only.
Done when: every line in every listed doc matches the code; the report names each line changed or says none.
Commit:    one commit per repo that changed, `Notes docs trued to the landed code`. A marketplace doc change is a
           plugin change: fold it into the unpushed version bump when one is waiting, else bump the patch version.

## Proof

Commit 8fee070 · proof: diff read: three gui docs trued and oxfmt clean; marketplace triage.md trued in f163f83, riding the unpushed 1.12.0 bump · concerns: notes/design.md line that the target is the launched session folder left as written though launchFolder takes a session folder when the home sits outside its clone; title-required and pick-another-row lines not checked against sendRefusal
