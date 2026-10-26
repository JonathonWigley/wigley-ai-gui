# 13 — Doc re-read against the landed code

Status: not started
Type: Task
Wave: 7 · Depends on: 01–12
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Files:     modify only the docs below, in the repo each one lives in
Consumes:  the landed code of tasks 01–12
Produces:  docs that match the landed code; one commit per repo with the fixes, or no commit when nothing changed
Decisions: the docs were written ahead of the code, so each is a hypothesis (`wigley:writing-for-agents` § Doctrine
           before code). The code wins every disagreement unless the code breaks a decision in `plan.md` § Design
           Overview; that case is a concern for the lead, not a doc edit.

Read each doc line by line against the code it describes. Fix every stale line: a name, a path, a signature, a key, a
setting default, a text, an outcome, a file format field.

wigley-ai-gui (docs commit `1722d1e`):

- `AGENTS.md` — the Contents line, the live-jobs paragraph, the `src/shared/` tree (`agent-forms/`, `page/`), the
  `alerts/` line, the `forms/` and `primer/` plugin lines, the close-guard sentence, the "An agent form type" and "An
  agent form source" bullets, the self-test paragraph (`src/plugins/primer/main/selftest-script.ts`), the `npm test`
  list.
- `DESIGN.md` — the ToggleMark primitive line (builder name, what it shows) and the Primer surface line.
- `docs/keymap.md` — the `<Leader><Leader>` row and the scroll-views sentence.
- `docs/features/primer/design.md` — every section; the Keys table against `src/plugins/keymap.ts` bind for bind.
- `docs/features/master-plan.md` item 21 and `docs/features/followups.md`.

wigley-ai-marketplace (docs commit `804cf0e`):

- `plugins/wigley/scripts/forms/README.md` — § The feature primer against the GUI tool definitions
  (`src/plugins/primer/main/tool-definitions.ts`), the payload builders, the store folder, the fingerprint fields,
  `relay.py` and `wait_guard.py`; the Contents line, the intro, the boundary rules and the local commands.
- `plugins/wigley/skills/feature-primer/SKILL.md` — the tool names, the outcomes it handles, the README pointer.
- `README.md`, `AGENTS.md` — the server list and the Done list against `plugin.json` and the scripts folder.
  `AGENTS.md`'s tree line for `hooks/hooks.json` names only the forms round: it now covers primers too.
- `plugins/wigley/skills/retro/criteria.md` — the primer file sentence against the retro readers.

Also grep both repos for stale references the run left: `wigley-primer` (server name, outside the store folder path
`~/.agents/wigley-primer/`), `scripts/primer`, `scripts/dashboard`, `ScriptedRoundPresenter`, `createRoundStore`,
`createFormsService`, `setOpenCount(` with one argument. Fix each one in a doc; report each one in code as a concern.

Done when: every doc above is read line by line, every stale line is fixed, the grep finds no stale reference, and the
fixes are committed (one commit per repo that changed).
Commit:    one commit per repo, message naming each doc fixed and why

## Proof
