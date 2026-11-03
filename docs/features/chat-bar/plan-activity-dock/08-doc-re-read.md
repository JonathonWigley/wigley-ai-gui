# 08 — Doc re-read

Status: done
Type: Task
Wave: 5 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Files:     modify (only where a line is stale) `DESIGN.md` · `docs/features/agent-chat/design.md` ·
           `docs/features/chat-bar/design.md` · `docs/features/layouts/design.md` · `AGENTS.md`
Consumes:  the landed code of 01–07
Produces:  each doc written ahead true to the landed code
Decisions: the docs were written ahead from the plan and are hypotheses until this re-read
           (`wigley:writing-for-agents` § Doctrine before code) · `AGENTS.md` carries a peer's uncommitted
           paragraph (plan.md precondition 1): edit only the chat layout parts paragraph in `AGENTS.md` (the
           `working` part and `activityInTranscript` lines), and commit by the peer hunks rule there

## Steps

Check each doc line by line against the landed code, and fix every stale line:

1. `DESIGN.md` § Surfaces, the **Chat** bullet: the dock's live look (time `m:ss`, state word, 3 tool calls in mono,
   newest in `fg`, failed in `status-error`, counts), the finished line's text and colour, the hidden state, the
   activity lines under the flag, and the composer's order (composer parts, activity dock, attachments, box, status
   line) — against `default/layout.js` and `chat.css`.
2. `docs/features/agent-chat/design.md`: Vocabulary (Chat entry's agent id, Activity line, Activity dock); § Chat
   plugin's Chat tab bullet, Activity line (the flag paragraph), Activity dock (header, state, action box of 3,
   counts, finished line: word, time from the user's message to the last result, summed cost, no line without a
   result, update in place); § Layouts (the `working` part's two inputs, the `working` slot's left-out rule, the
   flag and its pick); § Plans — against `layout.d.ts`, `working-turn.ts`, `activity-dock.ts`, `composer-kit.ts`,
   `entry-list.ts`, `read-chat-layout.ts`.
3. `docs/features/chat-bar/design.md`: the composer diagram and list, § The activity dock, Subagent facts › Tool
   calls, Decisions, the Rejected note — against the same files and `stream-decoder.ts`.
4. `docs/features/layouts/design.md`: the `chat` adopter row; the `Space z l c` row — read
   `src/plugins/chat/main/preview/preview-session.ts` and check the row against it (the preview's finished turn
   shows in the dock, since the preview holds a `result` entry; its steps and result show in the transcript only
   under the flag). Task 09 check 7 reads the `chat-preview` screenshot for the same claim.
5. `AGENTS.md`: the chat layout parts paragraph (`working`, `activityInTranscript`).
6. Fix the stale `layout.d.ts` or code comments found on the way, in the same commit, and name them in the report.
7. Last, run `grep -rniI "working block" src docs --include='*.ts' --include='*.js' --include='*.css'
   --include='*.md'` (leave out `node_modules`, `out` and `.git`). Fix each hit, unless it is history: the chat-bar
   design's "replaces the working block" line and the agent-chat design's "Plan G — working block" stay. Name each
   fix in the report.

Done when: every listed doc section is checked; each stale line is fixed or none was found; the step 7 grep shows
           history hits only; and the report names each fix
Commit:    one commit for the fixes, when there are any. `AGENTS.md` holds a peer's uncommitted paragraph: stage
           only this task's hunks in it (`git diff AGENTS.md` cut to this task's hunks, then
           `git apply --cached <patch>`), never the peer's. When the two hunks overlap and cannot be cut apart,
           leave this task's `AGENTS.md` fix uncommitted and name it in the report (plan.md precondition 1). Any
           other file a peer holds dirty at commit time follows the same rule.

## Proof

Commit b97c085d · proof: diff read: one fix (layouts design Space z l c row); DESIGN.md, agent-chat and chat-bar designs, AGENTS.md paragraph checked true; working-block grep shows history only · concerns: none
