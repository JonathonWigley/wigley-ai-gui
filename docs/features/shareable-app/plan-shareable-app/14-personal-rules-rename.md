# 14 — Personal rules: rename to auri, cut what auri skills now hold, workflow-gate reads declared workflows

Status: not started
Type: Batch
Rung: hard · rewrites workflow-gate's level source and app-session test, and moves rule text between personal files and plugin skills, where a wrong cut drops a rule
Wave: 7 · Depends on: 01 (the `auri` tool names and the `auri@auri` install), 12 (the `auri` hooks replace workflow-gate's checklist halves and the AskUserQuestion hook this task removes), 13 (workflow-gate's live check reads the `wigley` plugin's `auri.json`)
Plan: [plan.md](plan.md)

Mandatory reads for this task: `~/wigley-agents/WigleyRepos.md`, `~/wigley-agents/AgentsStandardMapping.md`,
`~/wigley-agents/tools/workflow-gate/README.md`, and the `auri` skills written ahead in
`wigley-ai-gui/agent-plugin/skills/` (`forms`, `visuals`, `chatroom`, `workflows-and-checklist`).

Files (ai):
- modify `wigley-agents/AGENTS.md` · `wigley-agents/forms.md` · `wigley-agents/workflows.md` · `wigley-agents/decisions.md` · `wigley-agents/Terminal.md` · `wigley-agents/AgentsStandardMapping.md` · `wigley-agents/wiki/Main.md` · `wigley-agents/docs/features/followups.md`
- modify `wigley-agents/learning/candidates/make-workflow-step-names.md` · `wigley-agents/learning/candidates/forms-read-latest-state-on-close.md` · `wigley-agents/learning/candidates/forms-validation-lists-every-violation.md` · `wigley-agents/learning/candidates/launched-stash-records-removed.md` · `wigley-agents/learning/candidates/notice-only-round-sent.md`
- modify `wigley-agents/tools/workflow-gate/workflow-gate` · `wigley-agents/tools/workflow-gate/README.md` · test `wigley-agents/tools/workflow-gate/tests/test_workflow_gate.py`
- modify `wigley-ai-marketplace/plugins/wigley/skills/small/SKILL.md` · `.../skills/medium/SKILL.md` · `.../skills/spike/SKILL.md` · `.../skills/feature/SKILL.md` · `.../skills/make/SKILL.md` · `.../skills/feature-primer/SKILL.md` · `.../skills/feature-primer/audit.md` · `.../skills/review/SKILL.md` · `.../skills/review/triage.md` · `.../skills/retro/SKILL.md` · `.../skills/tech-spec/SKILL.md` · `.../skills/explore/SKILL.md` · `.../skills/clean-up-branches/SKILL.md` · `.../skills/debug/SKILL.md` · `.../skills/unity-playtest/SKILL.md` · `.../skills/unity-ux-flow/SKILL.md` · `.../skills/feature-export-quickview/SKILL.md`
- delete `wigley-ai-marketplace/plugins/wigley/skills/visuals/SKILL.md` · `wigley-ai-marketplace/plugins/wigley/skills/chatroom/SKILL.md`
- modify `wigley-ai-marketplace/plugins/wigley/scripts/retro/answers.py` · `.../scripts/retro/digest.py` · `.../scripts/retro/recall.py` · `.../scripts/retro/transcript.py` · test `.../scripts/retro/tests/test_recall.py` · `.../scripts/retro/tests/test_search.py`

Files (machine, outside any repo, never committed): modify `~/.claude/settings.json` (shared by `~/.claude-personal`
through a symlink) · `~/.agents/AGENTS.local.md` · delete `~/.claude/hooks/ask-user-question-to-forms`.

Bookkeeping: none.

## Why

After task 13 the `wigley` plugin carries no MCP server, and the app's tools arrive as the `auri` server of the
`auri` plugin. Every personal rule and skill that names the `wigley-forms` server, its tools' prefix, or a forms
round by that server's name now points at a server that does not exist. The generic how-to text of `forms.md`,
`workflows.md` § Headless and the `wigley` plugin's `visuals` and `chatroom` skills now lives in the `auri` skills.
A second copy is two sources of truth, so the personal files keep only what is personal and point at the `auri`
skill for the rest. `workflow-gate` hard-codes the level skills and detects an app session from the old tool prefix.
The checklist half of it moved into the `auri` plugin's hooks (task 12).

## Consumes

- The `auri` skills `auri:forms`, `auri:visuals`, `auri:chatroom`, `auri:workflows-and-checklist` ← written ahead
  (`wigley-ai-gui/agent-plugin/skills/`), shipped by 01.
- The `auri` plugin's checklist edit gate, Stop reminder, compact reminder and AskUserQuestion hook ← 12.
- `wigley-ai-marketplace/plugins/wigley/auri.json` with its `workflows[].claims` ← 13.
- `.claude-plugin/marketplace.json` named `auri`, listing `auri` at `./agent-plugin` ← 01.
- The tool name form `mcp__plugin_auri_auri__<tool>` (Claude Code) and `mcp__auri__<tool>` (Codex): plan.md § Shared
  names.

## Produces

- `workflow-gate`: `def declared_level_skills(config_dir: str, settings_path: str) -> set[str] | None` — the
  qualified and bare claim names of every enabled declared workflow, `None` when no declared workflow is found.
- `workflow-gate`: `def is_app_session(environ: Mapping[str, str]) -> bool` — true when `WIGLEY_SESSION_ROW` is
  set and not empty.

## Inventory (measured at plan time, re-verify)

Re-run before the first edit and work from its output:

```
cd ~/Documents/ai
command grep -rnI -E 'wigley-forms|wigley_forms' wigley-agents wigley-ai-marketplace/plugins/wigley \
  --exclude-dir=archive --exclude-dir=node_modules | grep -v '\.agents/wigley-forms'
command grep -rnI -E 'wigley:(visuals|chatroom)' wigley-agents wigley-ai-marketplace/plugins/wigley \
  --exclude-dir=archive --exclude-dir=learning
command grep -nE 'wigley-forms|wigley_forms|ask-user-question' ~/.claude/settings.json ~/.agents/AGENTS.local.md
```

At plan time the first grep listed 47 lines in 37 files, the second 21 lines in 10 files. These are outside this
task and are left alone: `wigley-ai-marketplace/plugins/wigley/scripts/forms/` (moved by 01),
`.../scripts/docs-index/` (moved by 09), both plugin manifests, the marketplace's root `AGENTS.md` and `README.md`
(task 13), `wigley-agents/learning/archive/` and the promoted rows of `wigley-agents/learning/INDEX.md` (records of
past sessions, which keep the names those sessions used), `wigley-ai-marketplace/archive/`, and every
`~/.agents/wigley-forms/` path (data folders keep their paths, plan.md § Boundary rules). A file the re-run lists
that is in neither list is renamed by the rules below and reported in the task's Proof.

## Decisions

**Rename rules** (one pass, plan.md Design Overview round 4):

- "the `wigley-forms` server's `<tool>` tool" becomes "the `auri` server's `<tool>` tool".
- "a `wigley-forms` round" and "one `wigley-forms` round" become "a forms round (`auri:forms`)" and "one forms
  round (`auri:forms`)". A second mention in the same section drops the skill name.
- `mcp__plugin_wigley_wigley-forms__<tool>` becomes `mcp__plugin_auri_auri__<tool>`; `wigley-forms__` and
  `wigley_forms__` prefix lists become `auri__`, and the Codex form `mcp__auri__<tool>`.
- `wigley:visuals` becomes `auri:visuals`, `wigley:chatroom` becomes `auri:chatroom`, and a section pointer into
  either keeps its section name when the `auri` skill has that heading (Images, Videos, Mocking a decision).
- `wigley-agents/wiki/Main.md`'s `[visuals](wigley:visuals)` becomes `[visuals](auri:visuals)`, and the docs
  strategy's `linkPrefixes` must resolve `auri:` (task 13's `auri.json` holds `"auri:"` → `"auri@app"`, or the
  link points at the file path; take whichever 13 landed, and report it).

**Cuts** — each personal file keeps only what an `auri` skill does not say, and points at that skill:

- `forms.md` keeps a one-paragraph intent that names `auri:forms` as the wording rules, then only these personal
  additions, each under the `auri:forms` heading it extends:
  - Questions: the recommendation follows the matching section of `decisions.md`; mocks were asked for in over a
    dozen sessions, so a look question carries them in every round of every workflow; a mock of a Unity prefab or
    scene is a `render-prefab` PNG or a playtest still by the mock steps in `wigley:unity-playtest` § Rendering a
    prefab; an app's screen is captured only through the project's own self-test or drive tooling, since the user
    does the browser testing (`AGENTS.md` § Browser testing). This last item takes the text of the deleted
    `wigley:visuals` § Mocking a decision route 1.
  - `approves`: the gated actions are those `ClaudeCode.md` § Harness lists.
  - Findings: what becomes a finding is `wigley:review`'s triage.
  - Notices: a Decided notice follows `decisions.md` § Decided notices.

  Every other line of today's `forms.md` is cut. Before cutting a line, find its meaning in `auri:forms`; a line with
  no home there is kept and listed in the Proof.
- `workflows.md` § Headless keeps its heading and two personal lines: a headless session keeps its level's steps
  and gates; an auto-answered pick never approves a hard-gated action (`AGENTS.md` § Hard gates) or a push. The
  rest of the section is replaced by a pointer to `auri:forms` § Headless. The pointers to `workflows.md` §
  Headless in `AGENTS.md`, `decisions.md` and `feature-primer/audit.md` stay valid and are left as they are.
- `workflows.md` § Picking a level: "the skill's start is what the app tags and the edit gate reads" stays true
  (the app tags from the declared workflow's claims, and workflow-gate reads them); leave it.
- The `wigley` plugin's `skills/visuals/` and `skills/chatroom/` folders are deleted. Their personal lines go:
  `visuals` § Mocking a decision route 1's Unity and browser-testing text to `forms.md` (above); `chatroom`'s
  "Unity clones stay `unity-pool`'s; the board only shows them" is dropped, because `auri:chatroom` § Claims states
  the general rule. The marketplace's version bump for the deleted skills rides task 13's bump, when 13 has not
  landed yet in the run; otherwise this task bumps MINOR (`wigley-ai-marketplace/AGENTS.md` § Changing a plugin).
- `AGENTS.md` § Communication's visuals and chatroom bullets name `auri:visuals` and `auri:chatroom`; the forms
  bullet names a forms round (`auri:forms`) and keeps its pointer to `forms.md` for the user's additions.

**workflow-gate** (after task 12, the checklist half is the `auri` plugin's):

- Remove the checklist gate, the `Stop` reminder and their texts (`CHECKLIST_ASK`, `CHECKLIST_DENIAL`,
  `CHECKLIST_REMINDER`, `LEVELS_WITHOUT_CHECKLIST`), and the `Stop` group from `HOOK_GROUPS`. The `PreToolUse` level
  gate stays. The `SessionStart` compact reminder keeps only the level skill's `## Reporting` section and its
  closing line; the step and checklist part goes, since the `auri` compact hook shows them.
- The level skills come from `declared_level_skills`: it reads `<config dir>/plugins/installed_plugins.json`
  (`<config dir>` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`), takes each install's `installPath`, reads
  `<installPath>/auri.json`, and collects every `workflows[].claims` entry of a workflow whose qualified id
  (`<plugin name>:<id>`, the plugin name being the install key before `@`) is not in `workflow.off` of
  `~/.config/wigley-ai-gui/settings.json` (`{ "workflow": { "off": [...] } }`). Each claim adds its qualified name
  and its bare name (after the `:`), as `LEVEL_SKILLS` holds both today. `LEVEL_SKILLS` is removed.
- No declared workflow found (no list, no `auri.json`, unreadable JSON) fails open: no `permissionDecision`, with the
  reason in the hook's log line as the other fail-open paths give it.
- `is_app_session` reads `WIGLEY_SESSION_ROW` from the hook's environment. It replaces `FORMS_TOOL_PREFIXES` and the
  transcript scan for a forms tool; `REMINDER_LINE_MARKERS` keeps only `Base directory for this skill`. The compact
  reminder runs only in an app session, as today.
- `DENIAL` and `REMINDER_INSTRUCTION` keep their `~/wigley-agents/workflows.md` pointers: the gate is personal.
- `install` wires two groups (`PreToolUse` with `Edit|Write|NotebookEdit`, `SessionStart` with `compact`) and removes
  a `Stop` group pointing at `workflow-gate` from each settings file it plans.
- The README's What it does, Decisions, Checklist checks and Compaction reminder sections are rewritten to match;
  Checklist checks is cut and its content replaced by one line naming the `auri` plugin's checklist hook.

**Machine files:**

- `~/.claude/settings.json`: delete the `PreToolUse` group whose matcher is `AskUserQuestion` (the hook moved to
  `auri`, task 12); run `workflow-gate install` to drop the `Stop` group. Keep `AskUserQuestion` in the deny list.
  Add `"mcp__plugin_auri_auri__*"` under `permissions.allow` only when a `mcp__plugin_wigley_wigley-forms__*` entry
  was there (none at plan time).
- Delete `~/.claude/hooks/ask-user-question-to-forms`.
- Install the `auri` plugin for terminal sessions, since task 13 removed the forms server from `wigley`:
  `claude plugin marketplace add ~/Documents/ai/wigley-ai-gui`, then `claude plugin install auri@auri`, once per
  profile (`~/.claude`, and with `CLAUDE_CONFIG_DIR=~/.claude-personal`); for Codex, the commands task 01 checked.
  This is the user's own plugin from the user's own clone, not third-party code. Task 17 points the marketplace at
  the new clone path.
- `AgentsStandardMapping.md`: the source-of-truth table gains a row for `wigley-ai-gui` (plugin `auri`) with the two
  install commands; § Plugins names it.
- `~/.agents/AGENTS.local.md`: line 199's `wigley-forms` round becomes a forms round (`auri:forms`); the
  AskUserQuestion bullet (lines 240–242 at plan time) says the `auri` plugin's hook denies the call; the
  `workflow-gate` bullet says it denies an edit until a declared workflow's claimed skill loads, and that the
  checklist gate and turn-end reminder are the `auri` plugin's hooks.

**Retro scripts:** docstrings and comments say "the `auri` server's forms tools". `transcript.py` matches a tool by
its bare-name suffix already, so old transcripts and new ones both read; the code does not change.

## Tests

- `test_workflow_gate.py`, rows added to the level-gate test's table, with the installed list and `auri.json` as
  temp-folder fixtures:
  - a declared claim `acme:small` passes an edit after a `Skill` call of `acme:small` — catches a gate still
    reading a fixed list
  - the bare name `small` typed as `/small` passes — catches a reader that drops bare names
  - a workflow listed in `workflow.off` does not pass its claim — catches a reader that ignores the off list
  - no `installed_plugins.json` passes the edit with no decision — catches a fail-closed gate
- `test_workflow_gate.py`: the checklist-gate and Stop tests are deleted with the code they test. The compact
  reminder test asserts the reminder holds the `## Reporting` text and no checklist line, with `WIGLEY_SESSION_ROW`
  set; and asserts no reminder with it unset — catches app-session detection still keyed on the tool prefix.
- `test_recall.py` and `test_search.py`: a row whose transcript names `mcp__plugin_auri_auri__ask_round` reads as a
  forms result — catches a suffix match bound to the old prefix. The old-name rows stay.

## Verification

```
cd ~/Documents/ai
command grep -rnI -E 'wigley-forms|wigley_forms|wigley:(visuals|chatroom)' wigley-agents wigley-ai-marketplace/plugins/wigley \
  --exclude-dir=archive --exclude-dir=node_modules --exclude-dir=forms --exclude-dir=docs-index \
  | grep -v '\.agents/wigley-forms' | grep -v 'learning/INDEX.md' | grep -v 'scripts/retro/tests/'
python3 -m unittest discover -s wigley-agents/tools/workflow-gate/tests
python3 -m unittest discover -s wigley-ai-marketplace/plugins/wigley/scripts/retro/tests
python3 wigley-ai-marketplace/scripts/check_manifests.py
command grep -nE 'wigley-forms|ask-user-question' ~/.claude/settings.json; test ! -e ~/.claude/hooks/ask-user-question-to-forms
claude plugin list | grep 'auri@auri'
```

Done when:

- the first grep prints nothing
- both test suites pass and `check_manifests.py` exits 0
- the settings grep prints nothing and the hook file is gone
- `claude plugin list` shows `auri@auri` in each profile
- an edit in a terminal session with no level skill loaded is denied by workflow-gate with `DENIAL`; the final
  verification task checks the live gate in an app session

Commit: one commit in `ai` for the repo files (machine files are not committed).

## Proof

<written by wigley:make>
