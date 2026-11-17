# 06 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify only lines found stale in the docs below
Consumes:  the landed code of tasks 01–05
Produces:  every doc line the plan touched, true against the landed code
Decisions: no docs were written ahead (plan.md § Docs written ahead); each task updated its own lines, so this pass
           checks those edits and the lines around them (`wigley:writing-for-agents` § Doctrine before code)

Check each doc line by line against the landed code, fix every stale line, and commit the fixes:

- `AGENTS.md`:
  - § Architecture, the "A key" bullet: what a chord's key may be, how a chord matches (typed character, physical
    key for Option where the Platform record says so and for non-Latin characters), AltGr typing (task 01).
  - The source tree's `processes/` line: `run`, `spawn`, `resolveProgram`, PATHEXT and shim handling (task 04).
  - The source tree's `claude-code/` line and any line naming how the app starts `claude` or the session host
    (task 05).
  - The source tree's `alerts/` line and "An ambient service" (alert counts), `files/` (the rename retry),
    `agent-forms/` (the saved-form folder store): still true after tasks 02 and 03.
  - No line names unity-pool's removed `pythonCommand` (`grep -n pythonCommand AGENTS.md`: no output; task 04
    adds no `programs.python` line).
- `docs/keymap.md`: every chord rule, the Shift-in-the-character sentence and the `Cmd+,` note (task 01).
- `src/contracts/keymap.ts` (the `PageBind` comment) and `prefix-completion.ts:124`'s comment (task 01).
- `docs/features/primer/design.md` § Alerts, `setOpenCount` (task 02).
- `docs/features/docs-browser/design.md:103` and `docs/features/unity-pool/design.md:114`, the Python (task 04).
- `docs/features/agent-chat/design.md:111`, the `claude` PATH lookup (task 05).
- `docs/features/intent-alignment/master-plan.md` § Lane P: all four boxes ticked.
- `docs/features/followups.md` § Platform and packaging: none of the four Lane P entries left, and task 05's
  **Session host starts a claude shim on Windows** entry true against the landed code.
- `src/plugins/unity-pool/manifest.ts` and any settings description that named `python3`, `py` or `python`.

GIVEN the landed code WHEN each doc line above is read against it THEN every line states what the code does.
Tests:     none — a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate).
Done when: every line above checked; stale lines fixed, or none found and that recorded in the Proof.
Commit:    one commit for the fixes, when any.

## Proof

Commit ddba3fbdf · proof: Diff read: keymap.md and the PageBind comment name the Option-chord and non-ASCII physical-key exceptions; every other listed line checked true against the code. typecheck and lint pass. · concerns: none
