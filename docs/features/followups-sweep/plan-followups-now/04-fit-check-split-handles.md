# 04 — Fit check passes split handle prompts

Status: not started
Type: Task
Rung: standard · adds one selector to an existing list (`PRIMITIVE_CLIPPING_SELECTORS`) and drops two workarounds
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "Self-test fit check flags every split handle's resize prompt".

Files:
- modify `src/main/drive/page-driver.ts`
- modify `src/plugins/agent-lines/main/selftest-script.ts`
- modify `src/plugins/live-view/main/selftest-script.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| The primitive list lacks the split handle | `grep -n "'.ui-split-handle'" src/main/drive/page-driver.ts` | no output |
| agent-lines works around it | `grep -n "'.ui-split-handle'," src/plugins/agent-lines/main/selftest-script.ts` | one line (≈117) |
| live-view works around it | `grep -n "'.chat-side-handle'," src/plugins/live-view/main/selftest-script.ts` | one line (≈107) |
| The hub's handle carries the primitive class | `grep -n "'ui-split-handle chat-side-handle'" src/plugins/chat/page/side-sections.ts` | one line |
| Every split handle carries `ui-split-handle` | `grep -rn "'ui-split-handle" src --include='*.ts' \| grep -v test` | `split.ts`, `pane-tree-view.ts`, `side-sections.ts` |

Consumes: `PRIMITIVE_CLIPPING_SELECTORS` and `withPrimitiveClipping` in `src/main/drive/page-driver.ts` (tree), which
both the self-test runner and drive's `fit` read.

Produces: `'.ui-split-handle'` in `PRIMITIVE_CLIPPING_SELECTORS`.

Decisions:
- **The primitive owns it.** Every split's handle holds its resize prompt past its 4px box by design
  (`split.css` `.ui-split-handle::after`), so the selector joins the primitive list after `'.ui-h-scroller-track'`, and
  the list's comment gains "and a split handle, whose resize prompt overflows it by design".
- **The workarounds go.** agent-lines drops `'.ui-split-handle'` and live-view drops `'.chat-side-handle'` from their
  `scrollsItself`, each with the comment sentence about the handle's prompt ("The split handle of the preview pane's
  Docs tab holds its prompt…" in agent-lines; "The hub's drag handle holds its resize prompt…" in live-view). The other
  entries and sentences stay.
- **No unit test.** A test that the list holds the selector restates the constant; the filtered self-tests below are
  the proof, agent-skills among them, which fails on this today.

GIVEN the hub's split handle showing during a held-width fit step
WHEN the self-test checks the fit
THEN it reports nothing for `div.ui-split-handle.chat-side-handle`

Tests: none added.

Done when: compiles; `npm run selftest -- --plugin agent-skills`, `npm run selftest -- --plugin context-sources`,
`npm run selftest -- --plugin agent-lines` and `npm run selftest -- --plugin live-view` each pass with no fit problem
naming a `ui-split-handle` (run one at a time; never the whole self-test).

Commit: one commit, "self-test fit: split handles clip their resize prompt as a primitive (fit check split handle follow-up)".

## Proof
