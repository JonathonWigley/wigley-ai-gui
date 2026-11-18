# 14 — Doc re-read

Status: done
Type: Task
Wave: 8 · Depends on: 13
Plan: [plan.md](plan.md)

Files:     modify (only where a line is stale) `AGENTS.md` · `DESIGN.md` · `docs/features/layouts/design.md`
Consumes:  the landed code of tasks 01–13
Produces:  every doc written ahead (commit `204d990b5`) and every doc line tasks 11–13 edited, true to the landed code
Decisions: the docs were written before the code (plan.md § Docs written ahead), so each is a hypothesis checked line
           by line (`wigley:writing-for-agents` § Doctrine before code) · a fix states what the code does, never what
           the plan intended

Check, line by line against the code:

- `AGENTS.md`: the `shell/` line in § Architecture (toasts through `shell-chrome.ts`); § A forms layout — what the app
  keeps (no rail header, no cancel dialog), the new parts named, the **Reloads** sentence (tasks 11–13).
- `DESIGN.md`: the **Dialog** primitive bullet (`drawFrame`, `dialogFrame`).
- `docs/features/layouts/design.md`: § Live defaults **Reload** (`revision` and `styleRevision`); § What a layout
  draws (lifecycle bullet, `saveStatus`, cursor prompts through `kit.keyHint`); the `shell` and `sessions` Adopters
  rows; § The primer's columns (the five part names as the primer contract spells them); § Decisions **A reload keeps
  the user's place** (box keeping through `editor-boxes.ts`, the release of a left-out box, per-part redraw, the style
  revision) and **A dialog follows its opener** (`drawFrame` required).
- Every part name a doc line quotes exists under that name in its owner's `layout.d.ts`
  (`command grep -n '<name>?(' <repo>/src/**/layouts/layout.d.ts`, quoted).
- `docs/features/followups.md` holds none of the seven Lane L follow-ups, and master-plan.md § Lane L has every box
  ticked (the command in plan.md Precondition 2 prints `0`).

Tests:     none: a doc edit runs no test
Done when: each line checked; each stale line fixed; nothing else edited
Commit:    one commit holding the doc fixes, pathspecs the docs changed; no commit when nothing was stale

## Proof

Commit f7c1c3000 · proof: diff read (5 doc fixes, 3 comment fixes) + compile (typecheck, lint clean); Lane L followups count 0, every Lane L master-plan box ticked · concerns: forms code names still say mount (mountTextBox, MountingDeps, card.mounted, isMounted) — names left for review; 'every text box survives a reload' checked only for EditorBoxes owners and chat
