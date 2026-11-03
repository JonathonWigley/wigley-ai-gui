# 08 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `docs/features/visuals/design.md` · modify `AGENTS.md` · modify `docs/features/followups.md` · modify `docs/features/layouts/design.md` · modify `docs/features/agent-chat/design.md` · modify `DESIGN.md` ·
           modify `src/plugins/visual/main/session-note.ts` (only when item 7 fails) ·
           modify `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/skills/visuals/SKILL.md`
Consumes:  the landed code of tasks 01–07
Produces:  each doc written ahead, true against the landed code
Decisions: docs written ahead are hypotheses and are re-read line by line (`wigley:writing-for-agents` § Doctrine
           before code)

Read each doc below line by line against the landed code. Fix every line the code contradicts. Each fix states what
the code does; it does not narrate the change.

1. `docs/features/visuals/design.md` (commit `ec09d7c`). Check the flow diagram's names (MarkdownRenderer, markdown
   mount, visual frames, `Bridge.serveVisual`, `wigley-visual`), the CSP and sandbox claims against
   `src/main/data-protocol/` and `src/renderer/visual-frames/`, the reuse rule against `markdown-mount.ts`, the theme
   order, the `Esc` and `v`/`h`/`l` keys against `src/plugins/keymap.ts`, and `addInstructions` against
   `src/plugins/chat/contract.ts`.
2. `AGENTS.md` (commit `ec09d7c`, the folder map lines for `visual-url.ts`, `markdown-mount.ts`, `data-protocol/`,
   `visual-frames/`, `visual/` and chat's exports). Check each named file and member exists with that name and that
   the description matches what it does. Add the map line for any new file the tasks created that the map does not
   name (for example the visual frames fake).
3. `docs/features/followups.md` — the "Markdown block contributions" item names `addFence`; check the name. Another
   session has uncommitted edits in this file: stage only this task's hunk (`git diff` the file first; build the
   index blob from `HEAD` plus this hunk, as the docs-ahead commit did, when a peer hunk is present).
4. `wigley:visuals` `SKILL.md` in wigley-ai-marketplace (commits `6fb5a28`, `e711df9`, `819c7a7`, `91b8ed2`, none pushed). Check every theme variable it lists exists
   in `src/config/theme-tokens.ts`, the "drawing visual…" copy, where visuals render, the no-cap height, `v` and the
   expand control, `Esc`, and the CSP limits (what the frame can load). A fix there commits in the marketplace repo;
   the plugin stays at 1.14.0 since 1.14.0 is not pushed (`git -C <marketplace> log origin/main..HEAD` shows
   the visuals commits). Add to the skill's variable list every token task 07's sample visuals use that the list does
   not name (`src/shared/sample-visuals.ts`). Run the marketplace's Done commands from its `AGENTS.md` after a fix.
5. `docs/features/agent-chat/design.md` — the launch diagram and the list of what every process start passes
   (measured at plan time: lines 70–75 and about 244–250, re-verify) gain `AgentStart.instructions` passed as
   `--append-system-prompt` (one value joined with a blank line, no flag when none are registered). Also record the
   fact the code cannot show: on a resume the CLI sends the system prompt it recorded on the conversation's first
   request until compaction (`--system-prompt-snapshot`, on by default), so a resumed conversation keeps its first
   launch's instructions. `DESIGN.md` — the surfaces over the `scrim` (about line 411) gain the visual overlay; the
   self-test screenshots the agent checks (about line 437) gain `chat-visuals`.
6. `docs/features/layouts/design.md` § Adopters — add the `visual` owner's row (its surfaces: the drawing card, the
   visual wrapper and expand control, the overlay), in the shape of the other rows.
7. The session note text in `src/plugins/visual/main/` — check it names the skill `wigley:visuals`, and that the
   skill's description triggers on what the note tells the agent to do. On a mismatch, edit the skill's description
   first; edit the note only when the description cannot carry it, since 05's test pins the note.

Done when: every line of the docs in items 1–7 matches the landed code; each repo's fixes are committed.
Commit:    one commit per repo for the fixes (none when nothing was stale; record "no stale lines" in Proof)

## Proof

Commit 6cc0e3a1 + marketplace f78537d · proof: diff read: each fix states the code; items 3, 6, 7 no stale lines; marketplace Done commands pass · concerns: none
