# 09 — Edit gate hook

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

All paths are in the `wigley-agents` worktree, `~/Documents/ai-dev/.worktrees/wigley-agents-workflow-levels/`, branch `workflow-levels`. Run no `install` in this task: task 12 does it, in the landing order.

Files:     create `tools/workflow-gate/workflow-gate` (executable, no extension, `#!/usr/bin/env python3`, standard library only) · create `tools/workflow-gate/README.md` · create `tools/workflow-gate/.gitignore` (the line `__pycache__/`) · test `tools/workflow-gate/tests/test_workflow_gate.py`

Consumes:  `~/wigley-agents/workflows.md` (tree, branch `workflow-levels`, commit 936f725): the denial names it · the hook input and output below (Claude Code hooks docs, `https://code.claude.com/docs/en/hooks`, read at plan time) · no task

Produces:  in `tools/workflow-gate/workflow-gate`:
           `workflow-gate hook` — reads one hook event as JSON on stdin; prints one decision as JSON on stdout, or nothing; always exits 0
           `workflow-gate install [--bin-dir <dir>] [--settings <path>]...` — prints one result as JSON; exits 0, or 1 with the reason on stderr and nothing changed
           `def level_skill_started(transcript_path: str) -> bool`
           `LEVEL_SKILLS` — the pinned skill names below
           `tools/workflow-gate/README.md`

Decisions:

- **What the hook gates.** The main agent's `Edit`, `Write` and `NotebookEdit`, through the matcher only (`Edit|Write|NotebookEdit`, an exact list per the docs). The script does not check `tool_name` again. `Skill` is not in the matcher, so a denied agent can always load its level: this is why the gate cannot deadlock.
- **A subagent passes.** `agent_id` non-empty in the event means a subagent or in-process teammate: print nothing. Do not read `agent_type`: the docs say a session started with `--agent` also carries it, and that session is a main agent.
- **Pinned `LEVEL_SKILLS`:** `wigley:light`, `wigley:medium`, `wigley:feature`, `wigley:feature-primer`, `wigley:make`, and each bare name `light`, `medium`, `feature`, `feature-primer`, `make`. The bare names match `startsSkill` in `src/plugins/workflow/contract.ts`, which accepts the bare name Claude Code also takes for a typed command. `wigley:review`, `wigley:debug` and `wigley:explore` do not count.
- **Pinned transcript shapes,** read from real transcripts of Claude Code 2.1.318 under `~/.claude-personal/projects/`. Both shapes may appear after other work, so scan the whole file; stop at the first match.
  - Skill call: a JSON line with `"type":"assistant"`, `"isSidechain":false`, and in `message.content` (a list) a block `{"type":"tool_use","name":"Skill","input":{"skill":"wigley:review"}}`.
  - Typed slash command: a JSON line with `"type":"user"`, `"isSidechain":false`, and `message.content` a string that starts with the tag. A skill: `<command-message>wigley:make</command-message>\n<command-name>/wigley:make</command-name>\n<command-args>…</command-args>`. A built-in has another order and indent: `<command-name>/compact</command-name>\n            <command-message>compact</command-message>…`.
  - Pinned match for the string, at its start only: `^\s*(?:<command-message>[^<]*</command-message>\s*)?<command-name>/([^<\s]+)</command-name>`. A user message that quotes the tag in its body must not match.
- **Parse each line; never search the raw file.** In a real transcript, the first lines that hold `"name":"Skill"` and `command-name` are `api-request-shape` and `attachment` (`prompt_snapshot`) lines, which carry the system prompt and the tool list. A substring search passes every session. Read only lines whose `type` is `assistant` or `user`. A line with `isSidechain` true does not count.
- **Speed.** Read the file line by line in binary. Run `json.loads` only on a line that holds `"Skill"` or `<command-name>`: a transcript can hold large `api-request` lines. A line that does not parse is skipped, since the last line can be partial while Claude Code writes it. A hook that times out does not block the call (docs), so the wired `timeout` is 10, the value `unity-pool hook` uses.
- **Denial,** per the docs' `PreToolUse` decision control: exit 0 and print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<text>}}`. Claude reads the reason. Pinned `<text>`, verbatim:

  `No workflow level has started in this session. Read ~/wigley-agents/workflows.md, name the level and its reason in one line, then load its skill: wigley:light, wigley:medium or wigley:feature (a plan folder runs through wigley:make, a primer through wigley:feature-primer). Then make this edit again. A skill started in this same message may not be in the transcript yet: make the edit again.`

  The last sentence is there because the docs say the transcript is written asynchronously and may lag.
- **Fail open, with the reason stated.** Print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":<text>}}`, no `permissionDecision`, exit 0, so the call goes through the normal permission flow. Pinned `<text>`: `workflow-gate: the edit passes without the level check, because <reason>.` Pinned reasons:

  | Case | `<reason>` |
  |---|---|
  | stdin is not a JSON object | `the hook input is not JSON` |
  | `transcript_path` missing or empty | `the hook input has no transcript_path` |
  | the file cannot be opened or read (missing file, a directory, no permission) | `the transcript <path> cannot be read: <OSError strerror>` |
  | any other exception in `hook` | `the hook failed: <exception text>` |

  A transcript that opens and holds no match is not this case: it is a denial, an empty file included.
- **A new session starts the gate again.** `/clear` starts a new transcript, so the next edit needs a level skill. This matches `workflows.md`. `/compact` keeps the file: a real transcript holds `/compact` and the earlier skill lines in one file. Clear & make sends `/wigley:make`, which passes.
- **`wigley:feature` does not deadlock on its plan files.** By its first plan write the transcript holds `wigley:feature`, from a Skill call or a typed command. Its drafters are subagents, which pass. `wigley:make` holds its own skill in the same way.
- **`install` profiles.** Default list: `~/.claude/settings.json` and `~/.claude-personal/settings.json` (`~/.agents/AGENTS.local.md` § Claude Code profiles). `--settings`, repeatable, replaces the list. On this Mac `~/.claude-personal/settings.json` is a symlink to `~/.claude/settings.json` (`ls -la`, plan time), so:
  - Resolve each path with `os.path.realpath` and take each real file once.
  - Write to the real file. A symlink stays a symlink.
  - A profile whose folder does not exist is skipped and named under `skipped`. A folder with no settings file gets a new one.
- **`install` merge.** Into `hooks.PreToolUse` add this group, last: `{"matcher":"Edit|Write|NotebookEdit","hooks":[{"type":"command","command":"<link> hook","timeout":10}]}`, where `<link>` is `shlex.quote` of the absolute link path. When a group in `PreToolUse` already holds a hook with that `command`, change nothing and do not rewrite the file. Keep every other key and group, in order. Write as `json.dumps(settings, indent=2, ensure_ascii=False)` plus a newline, the format `unity-pool` writes, through a temp file in the real file's folder and `os.replace`. Keep the file's mode: the real file is `0600`.
- **`install` link.** `<bin-dir>/workflow-gate` (default `~/.local/bin`) is a symlink to `~/wigley-agents/tools/workflow-gate/workflow-gate`, the home path expanded. The target is this fixed path, not `__file__`: task 12 runs `install` from the worktree before the tool reaches the clone, and the worktree is removed after that. Do not check that the target exists. A missing target means the hook cannot start. The docs class that as a non-blocking error: the call goes ahead, with a `hook error` notice. Correct when `os.path.realpath(link) == os.path.realpath(target)`. Anything else at the link path stops with exit 1: `<link> exists and is not a symlink to <target>; move it aside and run install again`.
- **`install` plans, then acts.** Read and merge every settings file and check the link first. A settings file that does not parse stops with exit 1 and names the path. Nothing changes on a stop.
- **Pinned result keys:** `symlink`, `target`, `settingsChanged` (real paths written), `settingsUnchanged` (real paths left), `skipped` (paths).
- **Scope.** Claude Code on macOS and Linux. On Windows, `install` stops with exit 1: `workflow-gate install has no Windows launchers; the rule stays prose on this machine`. A shell edit and Codex are out of scope (`docs/features/workflow-levels/design.md` § Decisions). The README says so and gives the removal: delete the group from `hooks.PreToolUse`, then the link.
- **README.** Follow `wigley:writing-for-agents`, with a Contents list: what the tool does, the decision table (pass, deny, fail open), the two transcript shapes and why it parses lines, `install` and its fixed link target, the symlinked profile, the scope, the removal.

GIVEN a main-agent `Edit` and a transcript with no level skill WHEN `hook` runs THEN it prints the denial with the pinned text
GIVEN a transcript with a Skill call or typed command for any of `LEVEL_SKILLS` WHEN `hook` runs THEN it prints nothing
GIVEN a transcript where only `api-request-shape` and `attachment` lines hold the skill name WHEN `hook` runs THEN it denies
GIVEN an event with `agent_id` and no level skill WHEN `hook` runs THEN it prints nothing
GIVEN `wigley:feature` typed and a `Write` to a `plan-x/plan.md` WHEN `hook` runs THEN it prints nothing
GIVEN an unreadable transcript WHEN `hook` runs THEN the edit passes and `additionalContext` states the reason
GIVEN `install` already ran WHEN it runs again THEN no file changes and `settingsChanged` is `[]`
GIVEN a profile whose `settings.json` is a symlink to another profile's WHEN `install` runs THEN the real file holds one group and the symlink stays

Tests:     `tests/test_workflow_gate.py`, `unittest` with a table and `subTest` as `tools/wigley-repo-files/tests/` does. Run the script through `subprocess` with `sys.executable`, stdin JSON and `HOME` set to a temp folder: the CLI is the seam.

           `GateDecision.test_table` — each row writes a transcript, runs `hook` with `tool_name` `Edit` unless named, and expects deny or pass. Deny means exit 0 and stdout JSON with `hookEventName` `PreToolUse`, `permissionDecision` `deny`, and a reason equal to the pinned text. Pass means exit 0 and empty stdout.

           | Row | Transcript or event | Expect |
           |---|---|---|
           | no skill | a user text line, an assistant text line | deny |
           | other skill | Skill call `wigley:review` | deny |
           | Skill call, each level | `wigley:light`, `wigley:medium`, `wigley:feature`, `wigley:feature-primer`, `wigley:make` | pass |
           | bare name | Skill call `light` | pass |
           | typed skill | `<command-message>wigley:light</command-message>\n<command-name>/wigley:light</command-name>\n<command-args></command-args>` | pass |
           | typed with args | `/wigley:make` with `<command-args>docs/x/plan-x</command-args>` | pass |
           | typed built-in | the `/compact` string, then no skill | deny |
           | skill before compact | Skill call `wigley:light`, then the `/compact` string | pass |
           | noise lines | an `api-request-shape` line and an `attachment` line, each holding `"name":"Skill"`, `wigley:light` and `<command-name>/wigley:light</command-name>` | deny |
           | sidechain | Skill call `wigley:light` with `isSidechain` true | deny |
           | quoted tag | user text `see <command-name>/wigley:light</command-name>` | deny |
           | tool result | a user line whose `content` is a `tool_result` list holding that tag | deny |
           | subagent | no skill, event `agent_id` `a1` | pass |
           | `--agent` session | no skill, event `agent_type` `x` and no `agent_id` | deny |
           | plan write | typed `/wigley:feature`, `tool_name` `Write`, `file_path` `/r/docs/features/x/plan-x/plan.md` | pass |
           | partial last line | Skill call `wigley:light`, then `{"type":"user` | pass |
           | only a partial line | `{"type":"assistant` | deny |
           | empty file | zero bytes | deny |

           `FailOpen.test_table` — exit 0, no `permissionDecision`, and `additionalContext` equal to `workflow-gate: the edit passes without the level check, because <reason>.` with the pinned reason. Rows: stdin `not json`; no `transcript_path`; empty `transcript_path`; a path that does not exist (`No such file or directory`); a directory as the path (`Is a directory`).

           `Install` — each test uses a temp `HOME` and `--bin-dir`:
           - `test_fresh` — `os.readlink(link)` equals `<HOME>/wigley-agents/tools/workflow-gate/workflow-gate`; `hooks.PreToolUse` equals one group with matcher `Edit|Write|NotebookEdit`, command `<link> hook`, `timeout` 10; `settingsChanged` names the file
           - `test_second_run_changes_nothing` — file bytes and `st_mtime_ns` equal; `settingsChanged` is `[]`
           - `test_keeps_other_settings` — a settings file with `permissions`, and a `Bash` group in `PreToolUse`, keeps both, the `Bash` group first
           - `test_symlinked_profile` — the second profile's `settings.json` is a symlink to the first's: one group in the real file, `os.path.islink` still true, the real path once in `settingsChanged`
           - `test_two_real_profiles` — two separate files: one group in each
           - `test_missing_profile_folder` — the path is under `skipped`, and no folder is made
           - `test_keeps_file_mode` — a `0600` file is `0600` afterward
           - `test_foreign_file_at_link` — exit 1, stderr holds `move it aside`, settings bytes unchanged
           - `test_bad_settings_json` — exit 1, stderr names the path, no link made

Done when: `test -x tools/workflow-gate/workflow-gate` passes; the test gate runs `python3 -m unittest discover -s tools/workflow-gate/tests` from the worktree root.

Commit:    one commit for the group, on `workflow-levels` of wigley-agents, by pathspec `tools/workflow-gate`. It does not land here: task 12 lands it.

## Proof

