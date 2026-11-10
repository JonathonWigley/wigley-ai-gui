# 03 — Doc re-read and follow-ups

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` (only if a line is stale) · modify `docs/features/followups.md`
Consumes:  everything 01 and 02 landed
Produces:  docs that match the landed code
Decisions: the doc written ahead is a hypothesis, re-read against the code (`wigley:writing-for-agents` § Doctrine before code)

## Changes

- Re-read the `AGENTS.md` sentence commit `62e3bb8f` added (the layer check paragraph, ending "since `src/shared`
  may not import the layout host.") line by line against the landed code: the function name, the file path, that
  its `layouts.show` draws through the real owner show, and that `startPagePart`'s `draw` throws. Fix any stale word.
- Remove both items from `docs/features/followups.md` § Foundations: **A throwing `ready` is silent in the part
  harness** and **The part harness cannot draw a layout part**. Leave every other item as it is.
- `grep -rn "ready of" src scripts docs AGENTS.md --exclude-dir=plan-part-harness-drawing` returns nothing but the harness's own thrown message
  (`part harness: ready of <id> failed`) and its test.

Done when: each check above holds; no code change.
Commit:    one commit for the group

## Proof

Commit 4ffb7368 · proof: diff read: both Foundations items removed, nothing else; AGENTS.md sentence holds against the code; ready-of grep shows only the harness message and its tests · concerns: none
