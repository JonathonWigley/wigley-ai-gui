# 07 — Doc re-read against the landed code

Status: not started
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:
- modify, where a line is stale: `~/Documents/dev/wigley-ai-gui/AGENTS.md`
- modify, where a line is stale: `~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`

Consumes: the landed code of 01–06; the docs written ahead (plan.md § Docs written ahead): wigley-ai-gui commits
`80f9941`, `57feb26` and `a550cbd`, wigley-ai-marketplace commit `44bf63a`.

Produces: no code. Each stale line fixed and committed, or the run log noting that none was stale.

Decisions:
- Load `wigley:writing-for-agents` before editing either file (`~/wigley-agents/AGENTS.md`, Workflow).
- Re-read only the lines plan A owns; the lines on files, processes, the code highlighter and the docs plugin belong
  to plan B and stay untouched, stale or not (plan.md § Docs written ahead). Plan A's lines in `AGENTS.md`, each
  checked against the code it names:
  1. The Contents line naming "mode, session tab".
  2. The intro: rounds shown "in its agent session's Form tab" — forms' `addTab` with title `Form`
     (`src/plugins/forms/page/forms-view.ts`).
  3. "The core supplies the shell's areas and modes" and the layout tree's `shell/` line ("… and its modes") —
     `src/renderer/shell/modes.ts`.
  4. The layout tree's `sessions/` and `forms/` lines: main "the session list — rows, the selected session, tool
     routing"; page "Sessions mode: the sidebar and each session's tabs"; forms page "the Form tab".
  5. The sessions paragraph: "every connected session has a row in the sessions sidebar until it disconnects or the
     user closes the row" — `connect` adds the row (`session-list.ts`); the close guard sentence.
  6. **A mode**: "registers its mode through the page plugin API" (`api.modes.add`), `Space k s` for Sessions,
     "pressed while its mode already shows, the same command toggles that mode's sidebar", "A hidden mode keeps its
     state". `Space k d` for Docs is plan B's and stays.
  7. **A session tab**: `addTab`; "forms adds a Form tab on a session's first round" — forms adds it when the
     session's first round view is created (05); "Tabs stay while the session's row does" (commit `a550cbd`) —
     check it against 05, which drops a session's tabs when its row leaves (closed by the user or ended); the keys
     `Option+o` / `Option+i` and `Option+Shift+o` / `Option+Shift+i`.
  7a. **A mode**: "it keeps no keys: each mode and each session tab is told when it becomes the visible one
     (`shown`), and its plugin sets its key scope there" (commit `a550cbd`) — check it against `Mode.shown`
     (`src/renderer/shell/modes.ts`), `SessionTabView.shown` and the visible-tab check (`sessions/page/start.ts`,
     `tabs.ts`), including that Sessions sets `sessions.idle` when no tab is visible; fix only what the code
     contradicts.
  8. **A key**: "An editor key carries a scope as a page key does and runs only while that scope is in force, so two
     plugins' editors may bind one vim key in different scopes" — `editorBindInForce` and the host's one mapping
     per key (`src/renderer/editor-binds.ts`, `codemirror-vim-host.ts`). Check whether the paragraph needs the
     landed rule that a key bound in any scope runs nothing outside its scopes, and that a bind whose keys begin
     another's is rejected; add it when an agent adding an editor key would otherwise trip on it.
  9. **An ambient service** and **A third-party tool** (the latter as `57feb26` left it: "the shared ones (editor,
     markdown)"): only the parts plan A could make false (none expected; both lines' new items are plan B's).
  Also check every other `AGENTS.md` line that names a member plan A renamed or removed: `showTab`, `closeTab`,
  `fill`, `activeSessionId`, `SessionView`, `In a text box (vim normal mode)`. Search for each and fix what names it.
- The marketplace README's Hello paragraph (§ The relay): `harness`: `claude` when `CLAUDECODE` is `1`, else `codex`;
  "optional to the app, which shows no harness for an older relay". Check it against `relay.py`'s `hello_from_env`
  and the app's parse (`relay-server.ts`: an unknown string reads as no harness; a non-string refuses the hello).
  Check the README's "App refuses the hello" bullet still lists the refusals the parse gives.
- A fix in a doc is a correction, which `~/wigley-agents/AGENTS.md` (Workflow) allows without asking.
- Commits: one in wigley-ai-gui for `AGENTS.md`, one in wigley-ai-marketplace for the README, each only when it
  changed; a README change is a plugin change, so it lands before or in the same push series as task 03's version
  bump (marketplace `AGENTS.md`, Changing a plugin) — when task 03 already bumped, this commit needs no second bump.

GIVEN the landed code WHEN each listed line is read against it THEN every line states what the code does.

Tests: none (a doc).

Done when: every listed line is checked; each stale one is fixed and committed; the run log names each fix, or says
none was stale.
Commit: one commit per repo that changed.

## Proof

