# 13 — One native-input reset in the input frame

Status: done
Type: Batch
Rung: standard · moves an identical CSS block into the primitive's stylesheet beside its `.ui-input .cm-editor` rules in `src/shared/page/ui/input-frame.css`
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups: `followups.md` L513 "One native-input reset in the input frame" and L539 "Redundant docs.css rule".

Files:     modify `src/shared/page/ui/input-frame.css` · modify `src/shared/page/ui/input-frame.ts` ·
           modify `src/plugins/docs/page/docs.css` · modify `src/plugins/settings/page/settings.css` ·
           modify `src/plugins/backlog/page/backlog.css` · modify `src/plugins/notes/page/notes.css` ·
           modify `src/plugins/sessions/page/sessions.css` · modify `src/plugins/session-stash/page/session-stash.css` ·
           modify `src/plugins/practice/page/practice.css`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| The primitive has no input rule yet | `grep -c "ui-input > input" src/shared/page/ui/input-frame.css` | `0` |
| Seven stylesheets hold the copied reset | `grep -ln "font: inherit" src/plugins/docs/page/docs.css src/plugins/settings/page/settings.css src/plugins/backlog/page/backlog.css src/plugins/notes/page/notes.css src/plugins/sessions/page/sessions.css src/plugins/session-stash/page/session-stash.css src/plugins/practice/page/practice.css \| wc -l` | `7` |
| Every reset box is a `textBoxInput` appended straight into an `inputFrame()` | `grep -rn "textBoxInput(" src --include='*.ts' \| grep -v test` | eleven calls: `docs-box` (tree-view, docs-dialogs), `settings-box-input` (row-box, settings-view), `backlog-filter-input`, `backlog-rename-input`, `session-rename-box`, `notes-title`, `session-stash-box`, `practice-filter-input`, `practice-import-input`; each followed by `<frame>.append(<input>…)` |
| The practice import box has no reset today | `grep -rn "practice-import-input" src --include='*.css' \| wc -l` | `0` |
| The docs selected-row rule repeats row.css | `grep -n "docs-tree.is-pane-inactive .ui-row.is-selected" src/plugins/docs/page/docs.css; grep -n "^.is-pane-inactive .ui-row.is-selected" src/shared/page/ui/row.css` | one line each, both setting `list-inactive-selection-background` and `fg` |
| No layout stylesheet styles these boxes' classes | `grep -rnE "\.(docs-box\|settings-box-input\|backlog-filter-input\|backlog-rename-input\|notes-title\|session-rename-box\|session-stash-box\|practice-filter-input\|practice-import-input)([^-a-z]\|$)" src --include='*.css' \| grep layouts` | no output |

Consumes:  nothing from another task
Produces:  one rule in `input-frame.css`:

```css
/* A plain text box (`textBoxInput`) inside the frame: the frame draws the
   box, so the input draws none of its own. */
.ui-input > input {
  background: transparent;
  border: 0;
  color: var(--wg-fg);
  font: inherit;
  min-width: 0;
  outline: none;
  padding: 0;
  width: 100%;
}
```

Decisions:
- A rule on `.ui-input > input`, not a class `textBoxInput` adds: every reset box is a direct child of an
  `inputFrame()`, and a selector keeps `text-box.ts` free of styling.
- Its specificity (0,1,1) is above each old class rule (0,1,0). No other rule styles these inputs (the layout check
  above), so nothing a layout sets is overridden; `.notes-title::placeholder` stays in `notes.css` as the one
  per-box rule.
- The follow-up names five copies; the same reset is in two more, and one box lacks it. All join (members found
  beyond the follow-up's list): `.session-stash-box` (`session-stash.css`) and `.practice-filter-input`
  (`practice.css`) lose their copies; `practice-import-input` (`import-box.ts`, a `textBoxInput` in an `inputFrame`)
  has no reset today and takes the frame's, so its native border and background go. That is the bug the follow-up
  names, met on one more box.
- Each deleted block is the eight declarations only. `.backlog-filter-input, .backlog-rename-input` is deleted whole
  (both sit in frames: `filterFrame.append(filterBox)`, `renameFrame.append(renameBox)`). Comments that described a
  deleted block go with it (`docs.css`'s "A docs text box inside its input frame…", `sessions.css`'s "The rename
  dialog's box."); a stylesheet left with an empty section keeps nothing for it.
- L539: delete `.docs-tree.is-pane-inactive .ui-row.is-selected` and its comment from `docs.css`; row.css's
  `.is-pane-inactive .ui-row.is-selected` sets the same two declarations, and no docs rule between the two
  specificities sets a selected row's background or colour.
- `input-frame.ts`'s comment on `inputFrame` gains: a plain `<input>` appended to the frame takes the frame's reset.
  `DESIGN.md`'s InputFrame row ("the frame around a text box") stays true, so this task leaves it alone (tasks 14 and
  15 edit `DESIGN.md`).

GIVEN any of the nine text boxes above WHEN it draws in its frame THEN it shows no border, background or outline of
its own, in the frame's font, filling the frame's width.

GIVEN the docs tree without focus WHEN a row is selected THEN it keeps the inactive selection fill, as today.

Tests:     none: a stylesheet move with no unit seam; the look of each box goes to the final verification task.
Done when: the diff holds the new rule and the eight removals; `npm run typecheck` passes (the comment edit).
Commit:    one commit: "Input frame: one native-input reset for every plain text box in it; drop the docs
           selected-row rule row.css covers (follow-ups: one native-input reset in the input frame; redundant docs.css
           rule)".

## Proof

Commit 0f3ea326f · proof: diff read against Produces; wave 1 typecheck clean; diff read sent back once to delete the emptied session-stash.css and its import · concerns: none
