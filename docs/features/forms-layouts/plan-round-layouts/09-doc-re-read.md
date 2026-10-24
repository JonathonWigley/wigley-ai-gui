# 09 — Doc re-read

Status: not started
Type: Task
Wave: 7 · Depends on: 06, 07, 08
Plan: [plan.md](plan.md)

Files:     modify only the docs below, where a line is stale
Consumes:  the landed code of 01–08
Produces:  every doc written ahead true to the landed code
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code), so each
           line is checked against the code, not against the plan
GIVEN the docs written ahead in `8ff01a66` and the marketplace docs from 06
WHEN each line is read against the landed code
THEN every name, path, key, setting, field and log line it states exists as stated
Tests:     none — a doc re-read makes no claim a test can check

Read line by line, each against the code it describes:

- `AGENTS.md`: A layout; A forms layout (and its sub-bullets); A finding origin (the grouped-answer sentence);
  Debug and testing keys; An item kind (its kit-part and `default` layout steps, which 05 may have changed); the
  forms line of the Architecture tree; Running and testing (the preview round line).
- `docs/keymap.md`: the `a` and `zl` rows, and no `zc` row.
- `docs/features/agent-chat/design.md` § Layouts.
- `docs/features/followups.md`: the layouts-service item, the origin-spec item and the chat partial-layouts item;
  no item still describes partial forms layouts or the forms page exports as missing. The clause on which plugins emit events,
  which 07 corrects, names forms among them.
- `docs/features/master-plan.md` item 15.
- `src/plugins/forms/layouts/layout.d.ts` comments and the `layouts/default/layout.js` header (they ship to the
  user's layouts folder).
- `../wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`, `skills/review/triage.md` and
  `skills/make/SKILL.md` step 8, as 06 left them.

Done when: every doc above is read in full against the code, every stale line is fixed, and the fixes are committed
(one commit per repo), or the report says nothing changed.
Commit:    one commit per repo for the fixes, or none when nothing changed; the marketplace commit is not pushed

## Proof

