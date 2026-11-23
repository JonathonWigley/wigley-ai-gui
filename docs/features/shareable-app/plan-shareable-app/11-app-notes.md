# 11 — App notes and tool descriptions point at `auri` skills, and unity-pool is off by default

Status: not started
Type: Batch
Rung: standard · copy changes to existing string constants (pattern: `SESSION_NOTE` in `src/plugins/visual/main/session-note.ts`) plus one default-list entry and one setting fallback; no seam another task consumes
Wave: 4 · Depends on: 04 (both edit `src/plugins/workflow/main/session-note.ts`; this task writes the note for 04's Checklist flow)
Plan: [plan.md](plan.md)

Mandatory reads for this task: `wigley-ai-gui/AGENTS.md` § Architecture (the unity-pool entry and the paragraph on
disabled plugins), `docs/features/feature-contributions/design.md` § The Checklist flow, and the `auri` skills under
`agent-plugin/skills/` (docs written ahead), so each pointer names a skill and section that exist.

Paths are under `wigley-ai-gui/` in the worktree `W` (`~/Documents/.worktrees/ai-shareable-app`).

Files:
- modify `src/plugins/chat/contract.ts` (`HEADLESS_NOTE`)
- modify `src/plugins/forms/main/mcp-wording.ts` (`NEXT_ON_AUTO_ANSWERED`)
- modify `src/plugins/visual/main/session-note.ts`
- modify `src/plugins/chatroom/main/start.ts` (`STANDING_NOTE`)
- modify `src/plugins/workflow/main/session-note.ts`
- modify `src/plugins/forms/main/tool-definitions.ts` · modify `src/plugins/forms/main/kinds/question/question-format.ts`
- modify `src/plugins/primer/main/tool-definitions.ts`
- modify `src/plugins/audio-picker/main/tool-definitions.ts`
- modify `src/config/settings.ts` · test `src/config/settings.test.ts`
- modify `src/plugins/unity-pool/manifest.ts` · modify `src/plugins/unity-pool/main/pool-cli.ts` · modify `src/plugins/unity-pool/main/start.ts`
- test `src/plugins/unity-pool/main/pool-cli.test.ts`, `src/plugins/unity-pool/main/start.test.ts`
- modify `~/.config/wigley-ai-gui/settings.json` (outside the repo; see Decisions, The user's settings)

Consumes: `CHECKLIST_WORKFLOW` and the engine's Checklist flow ← 04 (the workflow note describes it) · the `auri`
skill folders under `agent-plugin/skills/` (docs written ahead).

Produces: nothing another task consumes.

## Decisions

### Skill names

Each pointer names an `auri` skill as Claude Code names a plugin skill: `auri:<folder>`. The folders are the docs
written ahead under `agent-plugin/skills/`. This document uses `auri:forms`, `auri:visuals`, `auri:chatroom`,
`auri:workflows`, `auri:primer` and `auri:audio-picker`. Before the first edit, list `agent-plugin/skills/` and use
the folder names found there. A pointer to a section (`§ Questions`) is written only when that heading exists in the
skill; otherwise the pointer names the skill alone.

### The notes and descriptions

Each change below is the whole change to that constant. Keep the rest of each text as it is.

- `chat/contract.ts` `HEADLESS_NOTE` and `forms/main/mcp-wording.ts` `NEXT_ON_AUTO_ANSWERED`: replace
  "a hard-gated action (third-party code, destroying user state, a push): name what the gate needs in the reply and
  end the turn." with "an action that needs the user's own yes (an install, a step that deletes the user's data, a
  push, or any action the user's rules gate): name what it needs in the reply and end the turn." The two constants
  say the same rule, so write the clause once as an exported constant in `chat/contract.ts` only if `forms` may
  import from `chat` (check `src/plugins/forms/manifest.ts` `dependsOn`); otherwise edit both strings the same way.
  "Decided notice" stays: `Decided` is the app's own notice badge (`forms/contract.ts` `NoticeBadge`).
- `visual/main/session-note.ts` `SESSION_NOTE`: the last sentence names `auri:visuals` in place of `wigley:visuals`.
- `chatroom/main/start.ts` `STANDING_NOTE`: "the wigley-forms tools chatroom_post, …" becomes "the auri server's
  tools chatroom_post, …"; "Follow the wigley:chatroom skill" becomes "Follow the auri:chatroom skill".
- `workflow/main/session-note.ts` `SESSION_NOTE` becomes: "This app shows each session's task list, and its workflow
  step when a workflow runs. Send your list with set_workflow_checklist before your first edit: every step of the
  work in hand as concrete items, the whole list. Send it again as items finish or new ones appear. Call
  set_workflow_step only where a running skill names it. The auri:workflows skill holds the rules." The first
  `set_workflow_checklist` is what the `auri` edit gate (task 12) waits for, so the note must ask for it before the
  first edit.
- `forms/main/tool-definitions.ts` `askRoundDescription`: "How each item's text is worded: ~/wigley-agents/forms.md."
  becomes "How each item's text is worded: the auri:forms skill." The approves example list "(a push past PR
  protection, a pool hold's release or take, an edit to your own settings or hooks, start_session in another
  project)" drops "a pool hold's release or take". The comment above `formsTools` says "The two forms tools" in place
  of "The two wigley-forms tools".
- `forms/main/kinds/question/question-format.ts`: `QUESTION_CONTEXT_DESCRIPTION` ends "Wording: the auri:forms
  skill." `APPROVES_DESCRIPTION` drops "releasing or taking a pool hold, " and its example becomes "push `main` of
  my-repo to origin past PR protection".
- `primer/main/tool-definitions.ts` `OPEN_PRIMER_DESCRIPTION`: "Open the feature-primer form" becomes "Open the
  primer form"; "Send the primer rows (group 'primer') and then the standing tasks (group 'standing') other than the
  edge-case sweep, which the agent writes straight into the feature folder; each entry carries its work items."
  becomes "Send the primer rows (group 'primer') and then any standing tasks (group 'standing'); each entry carries
  its work items. The auri:primer skill holds the steps." The `slug` description becomes "Lowercase kebab-case; names
  the feature's folder."
- `audio-picker/main/tool-definitions.ts` `OPEN_AUDIO_PICKER_DESCRIPTION`: "Call it once the audio-sourcing skill
  has a shortlist, before wiring any sound" becomes "Call it once you have a shortlist of candidate sounds, before
  wiring any sound; the auri:audio-picker skill holds the steps".
- No change to `chat/main/start.ts` and `agent-strip/main/start.ts`: plan.md lists them under Wording, and their
  instructions name "the Auri app", which is the app's shown name; they name no personal skill or file (checked at
  plan time by the grep in Verification).

### Unity-pool off by default

- `config/settings.ts` `coreDefaultSettings`: `plugins.disabled` becomes
  `['agent-lines', 'usage-tab-line', 'docs-session-tab', 'unity-pool']`. The demo still shows it, because
  `runDisabledForNow` starts each default-disabled plugin (AGENTS.md § Architecture, disabled plugins), and the
  self-test runs with an empty disabled list (`src/main/main.ts` near line 826, measured at plan time).
- `unity-pool.scriptPath` keeps its default `''`. Empty now means no script: `resolveScriptPath` is removed;
  `start.ts`'s `cliDeps` passes the raw setting; `runPoolCommand` answers `{ ok: false, error: 'no-cli', message:
  'No unity-pool script is set: set unity-pool.scriptPath in Settings.' }` for an empty `scriptPath` without a stat,
  and keeps today's `no-cli` stat answer for a set path with no file. The `~/.local/bin/unity-pool` and
  `~/wigley-agents/tools/unity-pool/unity-pool` fallbacks leave the code.
- `unity-pool/manifest.ts` `settingInfo.scriptPath.description` becomes "The unity-pool script the panel's Hold,
  Release and Open buttons run with the core programs.python Python; ~ is the home folder. Empty, the buttons run
  nothing and say no script is set." The comment above the removed helper goes with it.
- The pool watch keeps reading `~/.local/state/unity-pool/` (`start.ts` `stateRoot`): that is the tool's state-file
  contract, and with the plugin off by default nothing reads it. Task 15's boundary check must allow this one path
  (open question in the report).

### The user's settings

The user runs unity-pool today and wants it on. Arrays replace whole in `settings.json` (`src/main/config/user-settings.ts`,
`mergeSetting`), and the file holds no `plugins` key (measured at plan time). Edit
`~/.config/wigley-ai-gui/settings.json` to add `"plugins": { "disabled": ["agent-lines", "usage-tab-line",
"docs-session-tab"] }` and `"unity-pool": { "scriptPath": "~/.local/bin/unity-pool" }`, merging into any key a later
read finds there. Both values are valid for the app before and after this change, so the edit is safe at any point
of the run. Report the edit. A machine whose settings name another script path (Windows) is outside this run.

## Behaviour

GIVEN the default settings WHEN the app starts THEN unity-pool does not run.
GIVEN `unity-pool.scriptPath` is `''` WHEN the panel's Hold runs THEN the answer is `no-cli` with "No unity-pool script
is set: set unity-pool.scriptPath in Settings." and no file is read.
GIVEN `unity-pool.scriptPath` names a missing file WHEN Hold runs THEN the answer is `no-cli` "unity-pool not found at <path>".

## Tests

- `config/settings.test.ts`: the default `plugins.disabled` row gains `'unity-pool'`. Catches a default that turns the
  pool back on for a user with no pool.
- `unity-pool/main/pool-cli.test.ts`: `resolveScriptPath_Empty_DiffersByPlatform` and `resolveScriptPath_Set_KeepsIt`
  go with the helper; add `runPoolCommand_EmptyScriptPath_AnswersNoCliWithoutStat` (the files fake records no
  `stat`; the message is the pinned text). Catches a fallback path that creeps back.
- `unity-pool/main/start.test.ts`: the table rows at lines 105 and 157 (measured at plan time, re-verify) that expect
  `/home/.local/bin/unity-pool` for an empty setting change to the `no-cli` answer.
- The note and description constants have no literal-text tests (the existing tests import the constants), so no
  test changes for them.

## Verification

```
cd /Users/jonathonwigley/Documents/.worktrees/ai-shareable-app/wigley-ai-gui
npm test -- src/config src/plugins/unity-pool src/plugins/forms src/plugins/primer src/plugins/audio-picker src/plugins/chat src/plugins/chatroom src/plugins/visual src/plugins/workflow
npm run typecheck && npm run lint
npm run selftest -- --plugin unity-pool
grep -rn "wigley-agents\|wigley:\|wigley-forms\|feature-primer\|audio-sourcing\|unity-pool/unity-pool\|\.local/bin/unity-pool\|pool hold\|new-games" src/plugins/chat src/plugins/agent-strip src/plugins/visual src/plugins/chatroom src/plugins/workflow/main/session-note.ts src/plugins/forms src/plugins/primer src/plugins/audio-picker src/plugins/unity-pool --include='*.ts' | grep -v '\.test\.\|selftest\|preview\|demo\|fixture'
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.config/wigley-ai-gui/settings.json')));print(d['plugins'],d['unity-pool'])"
```

The grep prints nothing. The last line prints the two values the user's settings now hold.

## Done when

- The commands above pass, and the grep prints nothing.
- The user's `settings.json` holds the two keys, and the report names that edit.

Commit: one commit for the group (the user's `settings.json` is outside the repo and is not committed).

## Proof

