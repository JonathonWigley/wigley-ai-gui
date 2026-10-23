# 14 — Re-read the docs written ahead and retire the fixed follow-ups

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · `docs/keymap.md` · `docs/features/settings/design.md` · `docs/features/docs-browser/design.md` · `docs/features/agent-chat/design.md` · `docs/features/followups.md` · `docs/features/master-plan.md`
Consumes:  every landed task
Produces:  no code
Decisions: docs written ahead are hypotheses until checked against the landed code (`wigley:writing-for-agents` § Doctrine before code) · the follow-up entries go in this task, not per task, so parallel tasks never share these two files

1. Check each line commit `9dab181` wrote, line by line, against the landed code, and fix every stale line:
   - `AGENTS.md`: the `files/` line (byte reads exist as `Files.readBytes`), the mode bullet (`ModeHandle.picked()` and
     what it closes).
   - `docs/keymap.md`: the `v` row (`vt` bound to `docs.toggleTree`, the `groups` name `view`).
   - `docs/features/docs-browser/design.md`: `Space v t` in both views, `Alt+h` revealing, the overlay closing on a pick
     (row, click, `l`, Enter; not a group toggle), the three tree lines and their keys, and the hidden-tree line naming
     `Space v t`.
   - `docs/features/agent-chat/design.md`: the `raw` exception matches what `stream-decoder.ts` drops.
   - `docs/features/settings/design.md` (written in the plan's own commit): a section opened by click or Enter closes
     the narrow overlay; the first-show open does not.
2. Remove from `docs/features/followups.md` every entry this plan fixed (measured at plan time, re-verify each by
   its text): the event bus listener (Extensibility § Unloading and reload), `chat.askPermission` null input, the
   sessions drive `connected` map, the chat sign-in `sessions` read, the raw deltas, the rail notice entries, the
   narrow side bar overlay click, the empty docs tree, the session Docs tab tree key, the focus ring, layout `copy`,
   forms submit and cancel, the cancel prompt over Docs mode, the Split mid-drag, the refused background close, the
   review list rebuild, `forms.css` scoping, `ConfigStore.dispose`, and the `<` leader.
3. Remove step 1 from `docs/features/master-plan.md` and renumber nothing: the later steps keep their numbers, and the
   Order diagram and the "Start with step 1" line say the sweep has landed.

Done when: every line from step 1 matches the code; `grep -n` for each removed follow-up's key phrase in
`followups.md` finds nothing; `master-plan.md` no longer lists step 1's items.
Commit:    one commit, "Step-1 bug sweep: docs re-read against the landed code; fixed follow-ups retired"

## Proof
