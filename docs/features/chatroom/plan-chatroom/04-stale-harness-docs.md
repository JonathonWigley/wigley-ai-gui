# 04 — Stale harness doc lines

Status: not started
Type: Task
Rung: standard · doc-only: it states settled code, so the pattern condition does not apply
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `docs/features/agent-harnesses/design.md` · modify `docs/features/intent-alignment/plan-lane-h-harness-seams/16-doc-re-read.md`
Consumes:  none
Produces:  none
Decisions:
- The cause, verified at plan time: `docs/features/agent-harnesses/design.md` is the design written ahead for the
  Lane H plan (`docs/features/intent-alignment/plan-lane-h-harness-seams/`). That plan has not started: every task
  document says `Status: not started`, and `master-plan.md` § Lane H has every box open. Commit `6da8397b8` wrote
  the design and copied its target state into `AGENTS.md` as present-tense fact, with no planned mark.
- `AGENTS.md` describes the code as it is now. Each stale passage is rewritten to the truth below. It does not
  get a planned mark, because the architecture tree and § Architecture describe only what exists.
- `agent-harnesses/design.md` stays Lane H's target design. It gets the planned mark that `wigley:feature`
  § Writing the plan step 1 gives: one block quote under the title, `> Planned in
  \`plan-lane-h-harness-seams\` (\`docs/features/intent-alignment/\`), not built yet: …`. Under the Contents list,
  add a short `## Today` section that lists the facts below. Then a reader of the design sees which parts exist.
  Lane H's doc re-read (its task 16) names neither the mark nor the Today section, so this task adds that step to
  task 16 (see Approach). Do not change Lane H's target text.
- The truth, verified at plan time. Check each item again against the tree before you write it:
  1. There is no `src/plugins/claude-code/`. The Claude adapter is `src/main/claude-code/` (for example
     `claude-code-harness.ts`, `claude-launch.ts`, `transcripts.ts`). The composition root builds it:
     `claudeHarness(...)` in `src/main/main.ts` (about lines 266-290) calls `createClaudeCodeHarness`, and
     `liveServices` (about line 364) and the drive harness pick (about lines 403-420) put it in the
     `agentHarnesses` list.
  2. `MainServices.agentHarnesses` is `readonly AgentHarness[]` (`src/contracts/plugin.ts`, about line 1091). It is
     a fixed list that the composition root gives. It is not a registry with `register`, `list` and `get`.
  3. No `core.agentHarnesses` slot exists. `grep -rn "agentHarnesses'" src` finds only the `Pick` in `main.ts`.
  4. The program setting is the core setting `claude.command` (`src/contracts/settings.ts` `claude: { command }`,
     `settingInfo` key `'claude.command'` in `src/config/settings.ts`). It is not `claude-code.command`.
  5. The profiles setting is chat's `profiles` (`chat.profiles`, `src/plugins/chat/manifest.ts`, about line 280).
     It is not `claude-code.profiles`.
  6. Chat contributes the `permission_prompt` tool (`src/plugins/chat/main/permission-tool.ts`). It is not the
     adapter.
  7. The relay's hello sends `protocol`, `session_id`, `project_dir`, `deadline_seconds`, `harness` and
     `config_dir` (`hello_from_env` in `wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`, about line 223).
     It sends no `row_id`. Sessions joins an owned row by the host session id: `open` refuses a null host id, and
     `connect` finds the owned entry that holds the hello's `session_id` (`entriesHolding`,
     `src/plugins/sessions/main/session-list.ts`, about lines 836-890). The adapter mints that id and passes it as
     `--session-id`. `claudeLaunch` still puts `WIGLEY_SESSION_ROW` in the process's environment
     (`src/main/claude-code/claude-launch.ts`, about line 78). The unity-pool CLI reads it as a claim's holder
     (`src/shared/session-env.ts`).
- The `AGENTS.md` passages to fix. These are the line numbers at plan time; find each one by its text:
  - The `claude-code/` entry in the `src/plugins/` tree (about lines 325-330). Move it to the `src/main/` tree as
    `claude-code/`, the adapter behind `AgentHarness`. Keep the description of what the adapter does (profile
    config folder, saved sessions, `claude auth`, `/usage`, `get_context_usage`, `get_settings`, the only place the
    app spawns `claude`). Drop "manifest.ts (the `command` and `profiles` settings)" and "registered through
    `services.agentHarnesses`". Say that the composition root builds it. Say that chat contributes
    `permission_prompt`.
  - The owned-session join paragraph (about lines 490-492: "the relay connection whose hello carries its row id
    (`WIGLEY_SESSION_ROW` …) joins that row"). It joins by the host session id that the app gave the process.
  - § A slot, the core slots list (about line 599). Remove `core.agentHarnesses`.
  - § An agent harness (about lines 856-860). Say that the composition root gives each harness adapter in
    `services.agentHarnesses`. Remove "the `claude-code` plugin registers Claude's" and the registry slot sentence.
    Keep the rule "no code outside a harness's adapter names its CLI, files, environment or ids", with "adapter
    folder" in place of "plugin".
  - The transcripts path (about line 870). Change it to `src/main/claude-code/transcripts.ts`.
  - Search `AGENTS.md` for `claude-code`, `core.agentHarnesses`, `row_id` and `registers Claude` again after the
    edits. Fix each other hit that states the Lane H design as fact. A hit that names the `claude-code` plugin as
    planned work in Lane H can stay.
- `AGENTS.md` is over 100,000 bytes. Read it with `offset`/`limit` around each passage.
GIVEN the tree at the plan's base WHEN an agent reads the fixed `AGENTS.md` THEN each statement about the Claude
  adapter, its settings, the harness list, the core slots and the owned-row join agrees with the code
GIVEN `agent-harnesses/design.md` WHEN an agent reads it THEN the planned mark and the Today section show what
  is built and what waits on Lane H
Tests:     none: a doc change. The proof is the diff and the grep for each item.
Approach:  Fix the `AGENTS.md` passages to the truth above. Add the planned mark and the Today section to
           `agent-harnesses/design.md`. In `plan-lane-h-harness-seams/16-doc-re-read.md`, add this line to the
           `design.md` item of its Approach: "remove the planned block quote and the `## Today` section from
           `agent-harnesses/design.md`". Lane H's task 16 rewrites the fixed `AGENTS.md` passages again, from today's
           shape to the Lane H shape, when Lane H lands. That later rewrite is not a regression. Say so in the
           report.
Done when: every item above is fixed or confirmed true. The grep `grep -n "src/plugins/claude-code\|claude-code\.command\|claude-code\.profiles\|core\.agentHarnesses\|row_id" AGENTS.md`
           prints no line that states one as present fact. The design carries the mark and the Today section.
           Lane H's task 16 holds the line that removes them: `grep -n "Today" docs/features/intent-alignment/plan-lane-h-harness-seams/16-doc-re-read.md`
           prints it.
           Report each passage changed. Report each fact that differed from the list above when you checked it.
Commit:    one commit for the group

## Proof
