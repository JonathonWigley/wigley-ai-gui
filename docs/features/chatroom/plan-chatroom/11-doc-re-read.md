# 11 — Doc re-read

Status: not started
Type: Task
Rung: standard · doc-only: a re-read of the docs written ahead against the landed code
Wave: 6 · Depends on: 01, 02, 03, 05, 06, 07, 08, 09, 10 (04 struck)
Plan: [plan.md](plan.md)

Files (wigley-ai-gui):         modify `docs/features/chatroom/design.md` · modify `AGENTS.md`
Files (wigley-ai-marketplace): modify `plugins/wigley/skills/chatroom/SKILL.md` · modify `plugins/wigley/scripts/forms/README.md` · modify `plugins/wigley/skills/make/SKILL.md`
Files (wigley-agents):         modify `AGENTS.md` · check `ClaudeCode.md`
Consumes:  the landed code of 01–10, read in the tree; no signature
Produces:  none
Decisions:
- Read each doc below line by line against the landed code. Fix every line the code makes untrue: a name, a
  default, a field, a route, a count, a log line. A doc follows the code, unless the code breaks a decision in
  `plan.md` § Design Overview. Report such a break to the lead as a concern, and do not change that doc line.
- Remove every "planned in `plan-chatroom`, not built yet" mark once its code is in the tree. Find them with
  `grep -rn "plan-chatroom" wigley-ai-gui wigley-ai-marketplace wigley-agents --include='*.md'` from the `ai`
  clone's top. Leave the plan folder's own files.
- **`wigley-ai-gui/docs/features/chatroom/design.md`**: remove the top block quote. Check each section against the
  code: the model's fields against `contract.ts`; the board's sources against `main/board.ts`; claims and the edit
  warning against `main/hook-handlers.ts`; the five tools and their arguments against `main/chatroom-tools.ts`;
  delivery and the nudge line's exact text against `main/delivery.ts`; the hook names, matchers and timeout against
  `wigley-ai-marketplace/plugins/wigley/hooks/hooks.json` and `scripts/chatroom/hook.py`; the viewer against
  09's page (mode, side bar, badge, activity, composer); mirrors against `addMirror`; store files against
  `main/jsonl-room-store.ts`; the guards and their settings against `manifest.ts`. Add the key `Space k c` to
  § The user in the room.
- **`wigley-ai-marketplace/plugins/wigley/skills/chatroom/SKILL.md`**: remove the planned paragraph under
  Contents (the fallback to "the route `~/wigley-agents/AGENTS.md` names today"). Check every tool name, argument,
  kind and the nudge line's text against the code.
- **`wigley-agents/AGENTS.md`**:
  - § Subagents, the dispatch prompt bullet: remove "Until the chatroom tools land (planned in
    `plan-chatroom`, not built yet), the brief names a progress file in the scratchpad that the agent rewrites at
    each phase instead".
  - § Communication, the chatroom bullet: remove "Planned in `plan-chatroom`, not built yet: until its tools
    appear, cross-session messages go through `SendMessage`".
  - Apply `wigley:writing-for-agents` to the two edited bullets. Do not change any other rule.
- **`wigley-agents/ClaudeCode.md`**: at plan time it has no line that sends cross-session talk to `SendMessage`.
  Check it again with `grep -n "SendMessage\|progress file" wigley-agents/ClaudeCode.md`. Fix a hit only when it
  routes talk between sessions. Report "no change" when there is no such hit.
- **`wigley-ai-marketplace/plugins/wigley/skills/make/SKILL.md`** (a member of the same category, found at plan
  time): step 5 (about line 47) says that a peer's uncommitted edit or live run is settled "with that peer over
  `SendMessage`". Change it to the project's chatroom (`wigley:chatroom`): read the board, then post a `question`
  to the holder. Leave line ~94 (a named teammate's report to its lead over `SendMessage`). That is talk inside one
  session's team, not between sessions. Run `grep -rn "SendMessage" wigley-ai-marketplace/plugins wigley-agents --include='*.md'`
  and treat each other hit that routes talk between sessions the same way. Leave `wigley-agents/learning/`: its
  files are records of past sessions.
- **`wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § The relay**: check the hook hello (the added
  `"hook"` field, one request line, one reply line), `endpoint.py`, and the stable relay id for a Codex session
  against `relay.py`, `endpoint.py` and `hook.py` as 02, 03 and 07 landed them. Fix each untrue line.
- **`wigley-ai-gui/AGENTS.md`** (over 100,000 bytes; read it with `offset`/`limit`):
  - The `src/plugins/` architecture tree: add a `chatroom/` entry in the tree's style, with the column at 17
    characters. Name `manifest.ts`, `contract.ts` (the records and the `chatroom.rooms` and `chatroom.place`
    slots), `main/` (the store behind `RoomStore` with its jsonl and memory adapters, the room service, the board,
    the five `chatroom_*` tools through sessions' `contributeTools`, the `chatroom.pre` and `chatroom.post` hook
    handlers through sessions' `addHookHandler`, delivery through chat's `send`, the dispatch and hand-back entries
    from `chat.agentEvent`, `addMirror`, the self-test script and the `seed` drive action), `page/` (Chatroom mode,
    the row badge through sessions' `addRowPart`, the row activity, the preview), `layouts/` (its Layout contract
    and `default` layout), and `docs/features/chatroom/design.md`. Use what the code holds, not this list.
  - The `sessions/` tree entry and its prose: add the hook route (`addHookHandler`) where the entry lists the relay
    server's parts, if 02 has not already added it.
  - § Running and testing, the self-test script list: add
    `src/plugins/chatroom/main/selftest-script.ts` for Chatroom mode, the row badge and the composer.
  - § Architecture, Debug and testing keys: add the chatroom preview `Space z l r` to the layout previews list.
  - Any line Lane H's landing wrote about the relay, harnesses or sessions (the passages task 04 was struck for) that 01–10 made untrue.
- Keep each doc's own style. Write fixes in ASD-STE100 Simplified Technical English where the doc uses it.
- Commit message: describe which docs changed and which planned marks were removed.
GIVEN the landed chatroom code WHEN an agent reads any of the docs above THEN each statement agrees with the code,
  and no "planned in `plan-chatroom`" mark is left outside the plan folder
Tests:     none: a doc change.
Done when: the `plan-chatroom` grep, run as `grep -rn "plan-chatroom" wigley-ai-gui wigley-ai-marketplace wigley-agents --include='*.md' | grep -v 'docs/features/chatroom/plan-chatroom/'`,
           prints no line. At plan time it printed exactly four: `wigley-ai-gui/docs/features/chatroom/design.md:3`,
           `wigley-ai-marketplace/plugins/wigley/skills/chatroom/SKILL.md:16`, and `wigley-agents/AGENTS.md:206` and
           `:219`. Each of the four is a mark this task removes. Every doc above is re-read and fixed; the
           marketplace Done checks `python3 scripts/check_pointers.py` and both `check_manifests.py` lines pass,
           run from the `wigley-ai-marketplace/` folder (the skill edits ride the one version bump this run's series makes past
           origin/main's wigley version, which task 03 makes; check it still exceeds origin/main's). Report each doc changed, each line fixed that is not a mark removal,
           and each concern.
Commit:    one commit for the group

## Proof
