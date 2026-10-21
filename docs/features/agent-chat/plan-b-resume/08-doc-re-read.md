# 08 — Doc re-read

Status: done
Type: Task
Wave: 7 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `docs/features/agent-chat/design.md` (each only where a line is stale or a fact
           below is missing)
Consumes:  every Produces of tasks 01–07, as landed
Produces:  docs that state the landed code, line by line
Decisions: the docs were written ahead of the code (commit `376f1cc`) and plan A's re-read kept plan B's lines as
           hypotheses, so each is checked now (`wigley:writing-for-agents` § Doctrine before code) · plan B has landed,
           so the `(plan B)` and `[plan B: …]` markers in `design.md` go: the lines then state what the app does ·
           a fact an agent working here needs and the code cannot show joins `AGENTS.md` at the volume of the lines
           beside it, and nothing more
GIVEN the docs written ahead and the landed code WHEN each line is read against the code it describes THEN every stale
      line is fixed and no line states a name, path, key, setting or behaviour the code lacks
Tests:     none — a doc check; the proof is the diff and the list of lines checked
Approach:  read each doc whole; for every line naming code — a path, a type, a member, a key, a file name, a behaviour
           — open the code and confirm it. Lines to check at least:
           `AGENTS.md`: the layout tree's `files/` line (it reads "file reads, atomic writes, rename, trash, folder
           lists and watching"; at plan time `Files` held no rename or trash — keep what the landed `Files` has, and
           name the bounded read and the modified time); `claude-code/` (it now also lists and reads Claude's saved
           sessions); `codemirror-vim/` (`@codemirror/autocomplete` is among its imports); `chat/` (its `main/` holds
           archived sessions and resume; its `page/` the start prompt's session step); **An agent harness** (listing
           a folder's saved sessions and reading one into chat entries are adapter calls, so Claude's transcript
           format stays in `src/main/claude-code/transcripts.ts`); **Plugin data** (chat's `archived-sessions.json`
           and `recent-folders.json` beside its layouts, if the paragraph lists plugins' files); the self-test
           sentence in **Running and testing** (chat's steps cover the resume list, archive and completion).
           `docs/features/agent-chat/design.md`: Flow (the start prompt line: folder, profile, then new or saved
           session), Agent harness seam **Locality**, Chat plugin **Slash completion** (Tab accepts; `/` at the box's
           start only) and **Resume and archive** (after the folder and profile; `x` archives or restores, `.` shows
           archived; history unread shows one notice and still resumes), Plans (plan B landed).
           Add to `AGENTS.md`, under **An agent harness**, one sentence: Claude's transcript format is undocumented and
           was measured on the installed CLI, so a resume that lists nothing or draws raw entries starts with
           `transcripts.ts` and a fresh look at a transcript's line shapes.
Done when: every listed line checked against the landed code, every stale one fixed, and the fixes committed; the
           commit message lists the lines changed, or says none were stale
Commit:    one commit for the group

## Proof

Commit `b38a08a`. Proof: diff read; every listed line checked against the code (AGENTS.md layout `files/`, `claude-code/`, `codemirror-vim/`, `chat/`, An agent harness, the self-test sentence changed; Plugin data kept; design.md Flow, Locality, Slash completion, Resume and archive, Plans changed).
