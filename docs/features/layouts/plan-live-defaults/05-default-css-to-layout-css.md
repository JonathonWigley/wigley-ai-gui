# 05 — Move each default's look CSS into `layouts/default/layout.css`

Status: done
Type: Parallel
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     per owner, below: create `<owner>/layouts/default/layout.css` · modify the owner's page CSS · modify the
           owner's `page/start.ts` (the shell: `src/renderer/renderer.ts`) · modify `src/declarations.d.ts` only when
           § The `?url` module type applies
Consumes:  `ShowLayoutOptions<L>.defaultStylesheet: string | null` in `src/contracts/plugin.ts` ← 03 (the shell's
           `layouts.show` in `renderer.ts` takes the same options)
           each `api.layouts.show` / shell `layouts.show` call passes `defaultStylesheet: null` ← 03
Produces:  `layouts/default/layout.css` in each of the 16 owners, each holding only moved rules, selectors unchanged
           `import defaultStylesheet from '../layouts/default/layout.css?url'` in each plugin's `page/start.ts`
           `import defaultChromeStylesheet from './shell/layouts/default/layout.css?url'` in `src/renderer/renderer.ts`
Decisions: only the rules for what the layout draws move (plan, rounds 1, 2) · the bundled `layout.css` is linked as a
           file, never bundled into the page CSS (plan, Decided) · CSS in shared files stays (this task, below)
GIVEN an owner whose default has a `layout.css` WHEN its page calls `layouts.show` THEN the host receives the bundled
      URL of that file as `defaultStylesheet`
Tests:     none new. The URL hand-off is a compile-time fact: `defaultStylesheet` is a required field, and the `?url`
           import types as `string`. The cascade check is a live check that task 07 (final verification) owns.
Done when: `npx tsc --noEmit` passes · `npm run lint` passes (it runs `scripts/check-styles.mts` over every file
           under `src/`, the new files included) · each owner's page CSS holds no selector its Moves list names, and
           its `layouts/default/layout.css` holds each one
Commit:    one commit for the group

## Reference — the pattern for every owner

Do these steps for each owner section below. The sections give each owner's own values.

1. Read the owner's page CSS file, its `layouts/default/layout.js`, and its `page/start.ts` (the shell:
   `src/renderer/renderer.ts`).
2. Create `<owner>/layouts/default/layout.css`. Put in it each rule the owner's **Moves** list names. Keep each
   selector and each declaration exactly as it is. Keep the source order. Keep the comment above each moved rule
   with that rule.
3. Delete each moved rule, and its comment, from the page CSS.
4. A moved rule inside `@media`, `@container` or `@keyframes`: copy the at-rule wrapper into `layout.css` around the
   moved rules. Keep the wrapper in the page CSS around the rules that stay. Delete a wrapper that holds no rule.
5. A selector list that names a moving part and a staying part (each marked **split** below): write it as two rules
   with the same declaration block. One rule holds the moving selectors and goes to `layout.css`. The other holds the
   staying selectors and keeps its place in the page CSS. Do not change the text of any one selector.
6. Start each new `layout.css` with a one-line comment that names what it styles, in the style of the page CSS
   file-head comments. When the page CSS file-head comment describes the moved rules, rewrite it to describe what
   stays.
7. In `page/start.ts`, add `import defaultStylesheet from '../layouts/default/layout.css?url';` directly after the
   `import defaultLayout from '../layouts/default/layout.js';` line. In the `api.layouts.show` call, change
   `defaultStylesheet: null` (written by task 03) to `defaultStylesheet`. Change nothing else in the file.
8. An owner with no rule to move (none at plan time) keeps `defaultStylesheet: null` and gets no `layout.css`.

How the lists were classified (use the same test for a rule this document does not name):

- A rule **moves** when its subject (the rightmost compound selector) is an element the default `layout.js` creates,
  or a kit primitive that the layout draws inside its own part root and that the selector reaches through a class
  the layout sets or through the default's `[data-layout-owner='<owner>'][data-layout='default']` root.
- A rule **stays** when its subject is an element the app or the owner's kit creates: slots, panes, sheets, splits,
  editors, text boxes, scrims, floating panels, the app-element slot contents, and kit parts selected with no class
  the layout sets. A rule stays also when the layout and the app both create its subject's class (named
  "shared" below), so the app-drawn copy keeps its look.
- A class the app creates and the layout only reuses counts as app-created.
- CSS in shared files stays where it is: `src/shared/page/ui/*.css`, `src/shared/page/markdown.css`,
  `status-line.css`, `pane-tree.css`, `list-picker.css`. It is kit and primitive CSS that every owner uses.

Cascade caution. The host appends the default's `<link>` to `<head>` after the bundled page CSS, so every moved rule
now comes later in the cascade than every rule that stays. Two results follow:

- A moved rule that lost to a later page rule of equal specificity on the same element now wins.
- A staying rule that overrode an earlier moved rule of equal specificity now loses.

For each moved rule, find the staying rules that select the same elements (same owner page CSS, the shared files
above, and the theme materials). Compare specificity and the old source order. Where the winner changes, report it as
a concern, with the two selectors. Do not change a selector or add `!important` to fix it. Task 07 checks the drawn
result live.

Counts below are rule blocks (a split counts once on each side; a `@keyframes` counts as one), measured at plan
time, re-verify.

## agent-lines

Files: create `src/plugins/agent-lines/layouts/default/layout.css` · modify `src/plugins/agent-lines/page/agent-lines.css`
· modify `src/plugins/agent-lines/page/start.ts`

- Moves (2): `.agent-lines-line` · `.agent-lines-line-elapsed`
- Stays (1): `.session-row-part[data-part='agent-lines.workingLine']` — its subject is sessions' row-part slot.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## agent-strip

Files: create `src/plugins/agent-strip/layouts/default/layout.css` · modify `src/plugins/agent-strip/page/agent-strip.css`
· modify `src/plugins/agent-strip/page/start.ts`

- Moves (14): every rule whose selector starts with `[data-layout-owner='agent-strip'][data-layout='default']`.
- Stays (1): `.agent-strip-scroller > .ui-h-scroller-track` — `agent-strip.ts` creates the scroller.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## backlog

Files: create `src/plugins/backlog/layouts/default/layout.css` · modify `src/plugins/backlog/page/backlog.css`
· modify `src/plugins/backlog/page/start.ts`

- Moves (15): `.backlog-homes > .backlog-pane` · `.backlog-repo` · `.backlog-list > .backlog-pane` ·
  `.backlog-list-header` · `.backlog-list-keys` · `.backlog-edge--start` · `.backlog-edge--end` · `.backlog-tags` ·
  `.backlog-detail-head` · `.backlog-followup` · `.backlog-detail-title, .backlog-editor-heading` ·
  `.backlog-detail-line` · `.backlog-editor > .backlog-pane` · `.backlog-editor-fields` · `.backlog-editor-keys`
- Stays (20): `.backlog-homes` · `.backlog-status` · `.backlog-home-rows, .backlog-rows` · `.backlog-sheet` ·
  `.shell-main > .backlog-sheet` · `.backlog-split` · the `@media (max-width: 640px)` block (2 rules) ·
  `.backlog-list` · `.backlog-row-actions-slot` · `.backlog-row-actions` ·
  `.ui-row-trailing + .backlog-row-actions-slot > .backlog-row-actions` · `.backlog-filter` ·
  `.backlog-filter-input` · `.backlog-detail` · `.backlog-editor` · `.backlog-editor-label` · `.backlog-editor-box` ·
  `.backlog-field-hint` · `.backlog-editor-box--body`
- Borderline: `.backlog-pane` is the layout's pane root, so the three `… > .backlog-pane` rules move although their
  parent is an app pane. `.backlog-editor-label` is shared: the app appends `label.backlog-editor-label` for a field
  the layout leaves out (`backlog-view.ts`), so it stays.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## chat

Files: create `src/plugins/chat/layouts/default/layout.css` · modify `src/plugins/chat/page/chat.css`
· modify `src/plugins/chat/page/start.ts`

- Moves (38): `.chat-assistant` · `.chat-streaming` · `.chat-thinking-body, .chat-raw-body` · `.chat-tool-result`
  (split from `.chat-json, .chat-tool-result`) · `.chat-muted` · `.chat-result` · `.chat-notice` ·
  `.chat-notice-error` · `.chat-activity` · `.chat-activity-summary` · `.chat-activity-failed` ·
  `.chat-activity-time` · `.chat-working` · `.chat-working-head` · `.chat-working-time` · `.chat-working-box` ·
  `.chat-working-action` · `.chat-working-action.is-current` · `.chat-working-action.is-failed` ·
  `.chat-working-counts` · `.chat-queued` · `.chat-queued-label` · `.chat-queued-text` · `.chat-permission-head` ·
  `.ui-floating.chat-composer` · `.chat-attachments` · `.chat-attachment` · `.chat-attachment-image` ·
  `.chat-status-line` · `.chat-status-repo, .chat-status-branch` · `.chat-dialog-part > .ui-dialog-actions` ·
  `.chat-dialog-text` · `.chat-sign-in-link-row` · `.chat-sign-in-link` · `.chat-image-viewer-frame` ·
  `.chat-image-viewer-image` · `.chat-image-viewer-count` · `.chat-image-viewer-count[hidden]`
- Stays (34): `.chat-tab` · `.chat-entries` · `.chat-entry-slot` · `.chat-entry-slot.is-cursor` ·
  `.chat-tab.is-box-focused .chat-entry-slot.is-cursor, .chat-tab.is-at-stop .chat-entry-slot.is-cursor` · the
  `@media (max-width: 800px)` block (`.chat-entries`) · `.chat-entry` · `.chat-json` (split) · `.chat-activity-slot` ·
  `.chat-entry-slot.chat-step-slot` · `.chat-queued-slot` · `.chat-permission-actions` · `.chat-permission-answer` ·
  `.chat-images` · `.chat-image-thumbnail` · `.chat-composer-parts` · `.chat-composer-parts:empty` ·
  `.chat-attachment-remove` · `.chat-box` · `.ui-input.chat-box:focus-within` · `.chat-status-parts-slot` ·
  `.chat-status-parts` · `.chat-status-part` · `.chat-type-hint` · `.chat-type-hint.is-box-focused` ·
  `.chat-running` · `.chat-running.is-idle` · `.chat-running-key + .chat-running-key` · `.chat-chip-key` ·
  `.chat-picker-keys` · `.chat-reason-box .cm-editor` · `.chat-reason-box .cm-scroller` ·
  `.ui-scrim.chat-image-viewer` · `.ui-scrim.chat-image-viewer[hidden]`
- Borderline: `.chat-entry` is shared: `entry-list.ts` draws `div.chat-entry.chat-raw` itself, so it stays.
  `.chat-json` is drawn by `chat-kit.ts`. `.chat-composer` is a class the layout adds to the kit's floating panel, so
  that rule moves; `.chat-image-viewer` is the app's scrim (`image-viewer.ts`), so its two rules stay.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## docs

Files: create `src/plugins/docs/layouts/default/layout.css` · modify `src/plugins/docs/page/docs.css`
· modify `src/plugins/docs/page/start.ts`

- Moves (38): `.docs-tree-pane` · `.docs-tree-header` · `.docs-edge--end` · `.docs-row--prompted` ·
  `.docs-row--prompted > .ui-row-trailing` · `.docs-filtered` · `.docs-filtered-text` · `.docs-hint` ·
  `.docs-line-slot > .ui-empty .docs-hint` · `.docs-line-slot > .ui-empty .docs-hint > .ui-key-prompt` ·
  `.docs-row-caret` · `.docs-row-star` · `.docs-row-end` · `.docs-row-time` · `.docs-doc-frame` (split from
  `.docs-doc-pane, .docs-doc-frame`) · `.docs-doc-frame` · `[data-doc='none'] .docs-doc-top` ·
  `.is-tree-hidden .docs-edge--start` · `.docs-doc-top` · `.docs-editor-frame` · `.docs-header` ·
  `.docs-header > .docs-path, .docs-header > .docs-chips` · `.docs-title` · `.docs-path` · `.docs-chips` ·
  `.docs-loaded` · `.docs-readonly` · `.docs-banner, .docs-prompt` · `.docs-banner` · `.docs-prompt` ·
  `.docs-frontmatter-box` · `.docs-frontmatter` · `.docs-frontmatter th, .docs-frontmatter td` ·
  `.docs-frontmatter th` · `.docs-prompt-keys` · `.docs-box-hint` · `.docs-confirm-text` · `.docs-doc-top` inside
  the last `@media (max-width: 800px)` block
- Stays (23): `.docs-tree` · `.docs-line-slot, .docs-slot` · `.docs-row-actions` · `.ui-row-trailing + .docs-row-actions`
  · `.docs-status` · `.docs-line-slot > .ui-empty` · `.docs-filter` · `.docs-box` ·
  `.docs-tree.is-pane-inactive .ui-row.is-selected` · `.docs-rows` · `.docs-sheet` · `.shell-main > .docs-sheet` ·
  `.docs-split, .docs-doc-pane` · `.docs-doc-pane` (split) · the `@media (max-width: 640px)` block (2 rules) ·
  `.docs-doc` · `.docs-doc > .docs-slot > .ui-empty` · `.docs-doc.is-editing` · `.docs-editor` · `.docs-completion`
  · `.docs-completion .ui-row-label` · `.docs-doc` inside the last `@media (max-width: 800px)` block
- Borderline: `.docs-tree`, `.docs-doc` and `.docs-editor` are panes `tree-view.ts` and `doc-view.ts` create; the
  layout creates `.docs-tree-pane`, `.docs-doc-frame` and `.docs-editor-frame` inside them. The selection rule stays:
  the app keeps selection.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## forms

Files: create `src/plugins/forms/layouts/default/layout.css` · modify `src/plugins/forms/page/forms.css`
· modify `src/plugins/forms/page/start.ts`

- Moves (12): `:where(.form-tab) .rail-list` · `:where(.form-tab) .round-head` · `:where(.form-tab) .round-heading` ·
  `:where(.form-tab) .round-overview` · `:where(.form-tab) .item[data-status='not_applicable'] .item-status` ·
  `:where(.form-tab) .item[data-status='not_applicable'] .context` ·
  `:where(.form-tab) .finding-proof .context-body` · `:where(.form-tab) .round-overview code` (split from
  `:where(.form-tab) .choice-text code, :where(.form-tab) .round-overview code`) ·
  `:where(.form-tab) .review .field-note` · `:where(.form-tab) .review-title` · `:where(.form-tab) .review-rows` ·
  `:where(.form-tab) .review-actions`
- Stays (83): every other rule in `forms.css`, `:where(.form-tab) .choice-text code` (split) included.
- Borderline: the layout sets `item` (through `kit.card(parent, 'item question')`), `finding-proof`, `review`,
  `round-head`, `round-heading`, `round-overview` and `rail-list`. The kit or the app creates `round`
  (`round-view.ts`), `context` (`base-kit.ts`), `answer`, `verdict`, `choice-*`, `badge-*` (`card-kit.ts`), `box`
  and `field-*` (`card-parts.ts`), `rail-*` entries and `review-row`, `review-*` cells (`layout-panes.ts`), so their
  rules stay. `:where(.form-tab) .item-head` is shared (`card-parts.ts` and the notice card), so it stays.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## gallery

Files: create `src/plugins/gallery/layouts/default/layout.css` · modify `src/plugins/gallery/page/gallery.css`
· modify `src/plugins/gallery/page/start.ts`

- Moves (12): `.gallery-status` · `.gallery-section` · `.gallery-section--framed` · `.gallery-states` ·
  `.gallery-cell` · `.gallery-cell--wide` · `.gallery-caption` · `.gallery-frame` · `.gallery-frame--dialog` ·
  `.gallery-frame > .ui-split` · `.gallery-frame > .ui-floating` · `.gallery-frame .ui-scrim`
- Stays (37): `.gallery` · `.gallery > .ui-sheet` · `.gallery-sections` and its `@media (max-width: 800px)` block ·
  `.gallery-material` through `.gallery-actions` (the sample contents `gallery-view.ts` draws) · every
  `.gallery-test-*` rule (the test shell, `test-shell-layout.ts`).
- Note: `gallery.css` is imported by `gallery-view.ts` and `test-shell-layout.ts`, not by `start.ts`. The `?url`
  import still goes in `start.ts`, after its `defaultLayout` import.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## keys

Files: create `src/plugins/keys/layouts/default/layout.css` · modify `src/plugins/keys/page/keys.css`
· modify `src/plugins/keys/page/start.ts`

- Moves (9): `.which-key-list` · `.which-key-row` · `.which-key-row.is-command .ui-row-label` ·
  `.which-key-row.is-prefix .ui-row-label` · `.keys-help-sections` · `.keys-help-list` · `.keys-title-bar-button` ·
  the whole `@media (max-width: 640px)` block (`.keys-title-bar-button`, `.keys-title-bar-hint`)
- Stays (3): `.ui-floating.which-key` (`which-key-view.ts` adds `which-key` to the floating panel) ·
  `.ui-dialog.keys-help-dialog` (`help-view.ts`) · `.keys-title-bar-slot` (`start.ts`)
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## notes

Files: create `src/plugins/notes/layouts/default/layout.css` · modify `src/plugins/notes/page/notes.css`
· modify `src/plugins/notes/page/start.ts`

- Moves (18): `.notes-row` · `.notes-row-keys` (split from `.notes-row-keys, .notes-cursor-prompt`) ·
  `.notes-row.is-cursor` · `.notes-row-label` · `.notes-empty` ·
  `.notes-tags, .notes-session-value, .notes-actions, .notes-markup-groups` · `.notes-tags > .ui-tag` ·
  `.notes-actions > .ui-button` · `.notes-target` · `.notes-strip` · `.notes-image` · `.notes-image.is-selected` ·
  `.notes-image-thumbnail` · `.notes-image-pen` · `.notes-confirm` · `.notes-confirm-text` · `.notes-markup-group` ·
  `.notes-markup-group .is-active`
- Stays (23): `.notes-fields` · `.notes-cursor-prompt` (split) ·
  `.notes-fields.is-box-focused :is(.notes-row-keys, .notes-cursor-prompt)` · `.notes-row-value` ·
  `.notes-row-value--one-line` · `.notes-row-value > .ui-input` · `.notes-box-hint` · `.ui-chip.notes-session` ·
  `.ui-chip.notes-session .ui-chip-label` · `.notes-title` · `.notes-title::placeholder` · `.notes-body` ·
  `.notes-image-remove` · `.notes-markup` · `.notes-markup-toolbar` · `.notes-markup-keys` · `.notes-swatch` ·
  `.notes-swatch--red` · `.notes-swatch--yellow` · `.notes-swatch--green` · `.notes-swatch--blue` ·
  `.notes-markup-host` · `.notes-flatten-host`
- Borderline: the `.is-box-focused :is(…)` rule names a layout class and an app class in one `:is()`, so it cannot
  split without a selector change; it stays. It has higher specificity than `.notes-row-keys`, so it still wins.
  `notes-session` is added by `notes-parts.ts`, so both `.ui-chip.notes-session` rules stay.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## primer

Files: create `src/plugins/primer/layouts/default/layout.css` · modify `src/plugins/primer/page/primer.css`
· modify `src/plugins/primer/page/start.ts`

- Moves (20): `.primer-tab .primer-review` (split from `.primer-tab .primer-card > *, .primer-tab .primer-review`) ·
  `.primer-tasks-list, .primer-items-list` · `.primer-tasks-list > .ui-section-header` · `.primer-card-heading` ·
  `.primer-card-tags` · `.primer-card-section` · `.primer-card-section-body` · `.primer-item-step` ·
  `.primer-item-include` · `.primer-review-tallies` · `.primer-review-problem-list` · `.primer-review-block` ·
  `.primer-review-fields` · `.primer-review-field-label` · `.primer-review-field-value` ·
  `.primer-review-task-head, .primer-review-item-line` · `.primer-review-task-name` · `.primer-review-items` ·
  `.primer-review-item-text` · `.primer-review-comment`
- Stays (38): every `.primer-tab …` pane rule (`.primer-tab`, `> .ui-empty`, `.primer-form`, `.primer-form > .ui-split-end`,
  `.primer-inner`, `.primer-main`, `.primer-card, .primer-review-pane`, `.primer-card > *` (split), `.primer-column`,
  `.box-keys`) and the `@media (max-width: 800px)` block · `.primer-card-edge` · every `.primer-column-*` rule and
  `.primer-items .primer-column-edge` · `.primer-column-body .ui-row:has(> .primer-row-prompt)` and its
  `> .ui-row-label` rule · `.primer-row-prompt` · `.is-pane-inactive .primer-row-prompt` · the three
  `.primer-tasks-foot` rules · `.primer-review-keys` · `.primer-task-trailing` · `.primer-count` ·
  `.primer-item-lead` · every `.primer-field…` rule · `.primer-box` and its three `.cm-*` rules ·
  `.primer-field:not(:focus-within) > .box-keys` · `.primer-review-actions`
- Borderline: `.primer-card`, `.primer-review-pane`, the columns and `.primer-items` are panes `primer-view.ts`
  creates; `.primer-review` is the layout's root inside the review pane. `.primer-field-hint` is shared: the kit
  creates it and the layout passes it as a key-hint class, so it stays.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## sessions

Files: create `src/plugins/sessions/layouts/default/layout.css` · modify `src/plugins/sessions/page/sessions.css`
· modify `src/plugins/sessions/page/start.ts`

- Moves (37): both `.session-pane` rules · `.session-pane-body` · `.session-pane-body > *` · `.session-side` ·
  `.session-side > .ui-section-header` · both `.session-sidebar` rules · every `.session-row` rule (both
  `.ui-row.session-row`, `.session-row-foot`, `.session-row-foot:not( … )`, `:not(.is-selected)`, the hover rule,
  `.is-selected`, both `.session-row > .ui-row-label`, `.is-on-screen`, `.session-row > .ui-row-detail` and its
  `@container session-rows (width < 170px)` block, `.session-row > .ui-row-trailing`, `.session-row-activity`,
  `.session-row .ui-dot[data-status='running']` and its `@media (prefers-reduced-motion: reduce)` block,
  `.session-row-status`) · `@keyframes session-dot-pulse` · `.session-tabs-bar` · `.session-tabs-bar > *` ·
  `.session-tabs-bar .is-no-target` · `.ui-tabs.session-tabs` · `.session-tabs .ui-tab` · `.session-tab-icon` ·
  `.ui-tab:hover .session-tab-icon, .ui-tab.is-hover .session-tab-icon, .ui-tab.is-active .session-tab-icon` ·
  `.sessions-empty` · `.session-rename-problem, .session-rename-hint` · `.session-rename-problem` ·
  `.session-rename-hint`
- Stays (23): `.sessions` · `.sessions > .pane-tree` · `.session-pane-edge` and its six `.is-left` / `.is-right` /
  `.is-up` / `.is-down` rules · both `.session-pane:has(> .session-pane-edge.is-…) > .session-pane-body .session-bodies`
  rules · `.session-edge` · `.session-row-parts` · `.session-row-part` · `.session-area` · `.session-bar-parts` ·
  `.session-bar-part` · `.session-bar-part:not(:empty)` ·
  `.session-tabs-close, .session-tabs-close.is-no-target + .session-pane-control` ·
  `.ui-icon-button.session-pane-control` · `.session-bodies` · `.session-bodies > *` · `.session-body` ·
  `.session-rename-box`
- Borderline: `@keyframes session-dot-pulse` moves because only the moved `.ui-dot` rule names it; confirm with
  `grep -n "session-dot-pulse" src/plugins/sessions/page/sessions.css` after the move (no hit). The edges, row and
  bar part slots, tab bodies and close control come from `sessions-parts.ts` and `session-tabs-view.ts`, so they
  stay. `.session-tabs-bar .is-no-target` moves: the layout's bar is its anchor.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## settings

Files: create `src/plugins/settings/layouts/default/layout.css` · modify `src/plugins/settings/page/settings.css`
· modify `src/plugins/settings/page/start.ts`

- Moves (19): `.settings-pane` (split from `.settings-pane, .settings-row-actions-slot`) · `.settings-edge` ·
  `.settings-edge--end` · `.settings-edge--start` · `.settings-head` · `.settings-row` ·
  `.settings-row:not(.is-selected):hover` · `.settings-row.is-selected` · `.is-pane-inactive .settings-row.is-selected`
  · `.settings-row.is-cursor` · `.settings-row-head` · `.settings-row-label` · `.settings-row-end` ·
  `.settings-row-value` · `.settings-row-value.is-unset, .settings-row-default` · `.settings-row-default` ·
  `.settings-row-description` · `.settings-binds` · `.settings-group-header`
- Stays (16): `.settings-sections` · `.settings-section-rows` · `.settings-row-actions-slot` (split) ·
  `.settings-filter-hint` · `.settings-row-actions` · `.settings-section-rows, .settings-rows` · `.settings-sheet` ·
  `.shell-main > .settings-sheet` · `.settings-broken:empty` · `.settings-bind` · `.settings-bind.is-struck .ui-kbd` ·
  `.settings-replaces` · `.settings-box` · `.settings-box-input` · `.settings-box-message` · `.settings-document`
- Borderline: `.settings-bind` is shared: `keymap-view.ts` creates `span.settings-bind` too, so both its rules stay.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## usage

Files: create `src/plugins/usage/layouts/default/layout.css` · modify `src/plugins/usage/page/usage.css`
· modify `src/plugins/usage/page/start.ts`

- Moves (23): every rule whose selector starts with `[data-layout-owner='usage'][data-layout='default']`.
- Stays (3): `.session-bar-part:has( > [data-layout-owner='usage'][data-layout='default'].usage-session-line )` ·
  `.session-bar-parts:has( > .session-bar-part > [data-layout-owner='usage'][data-layout='default'].usage-session-line )`
  · `.session-row-part[data-part='usage.rowLine']`
- Borderline: the two `:has()` rules name the default's root, but their subject is a sessions slot, so they stay.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## visual

Files: create `src/plugins/visual/layouts/default/layout.css` · modify `src/plugins/visual/page/visual.css`
· modify `src/plugins/visual/page/start.ts`

- Moves (9): every rule whose selector starts with `[data-layout-owner='visual'][data-layout='default']` (8) ·
  `.visual-open-hint:not(.chat-entry-slot .visual-open-hint), .chat-entry-slot :is(.visual-host, :has(.visual-host)) ~ * .visual-open-hint`
- Stays (4): `.ui-scrim.visual-overlay` · `.ui-scrim.visual-overlay[hidden]` · `.ui-scrim.visual-overlay > .visual-draw`
  · `.visual-frame-slot > *`
- Borderline: the hint rule's comment says "Any layout's", but only the default `layout.js` sets `visual-open-hint`
  (as the `kit.keyHint` class), so it moves; fix the comment to say the default's hint.
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## workflow

Files: create `src/plugins/workflow/layouts/default/layout.css` · modify `src/plugins/workflow/page/workflow.css`
· modify `src/plugins/workflow/page/start.ts`

- Moves (8): `.workflow-chip` · `.workflow-strip` · `.workflow-strip-detail` · `.workflow-flow` ·
  `.workflow-flow-detail` · `.workflow-flow .ui-section-header.is-current` · `.workflow-flow-tasks` ·
  `.workflow-flow-actions`
- Stays (6): `.workflow-stepper` · `.workflow-step` · `.workflow-step[data-state='done']` ·
  `.workflow-step[data-state='current']` · `.workflow-countdown` (all from `workflow-kit.ts`) · `.workflow-flow-tab`
  (`flow-tab.ts`)
- Import: `import defaultStylesheet from '../layouts/default/layout.css?url';`

## shell

Files: create `src/renderer/shell/layouts/default/layout.css` · modify `src/renderer/shell/shell.css`
· modify `src/renderer/renderer.ts`

- Moves (8): `.title-bar-context` · `.title-bar-context-title` · `.title-bar-context-detail` · `.activity-item` ·
  `.activity-item:hover, .activity-item.is-shown` · `.activity-item:hover` · `.activity-item.is-shown` ·
  `.config-problem-badge`
- Stays (34): every other rule in `shell.css`: the chrome frames (`.shell`, `.shell-title-bar`, `.shell-track*`,
  `.shell-part-slot`, `.shell-activity-bar`, `.shell-side-bar`, `.shell-right-bar`, the bar handles, `.shell-main`,
  `.shell-panel`, `.shell-status-bar`, `.shell-overlay`) — `shell-layout.ts`, `shell.ts` and `shell-chrome.ts` create
  them.
- Borderline: the design says the five chrome frames "take the layout's CSS", meaning a layout's CSS may restyle
  them; their default look is still the app's frame CSS, so it stays in `shell.css`.
- Import: `renderer.ts` already names the default `defaultChromeLayout`. Add
  `import defaultChromeStylesheet from './shell/layouts/default/layout.css?url';` directly after the
  `import defaultChromeLayout from './shell/layouts/default/layout.js';` line, and pass
  `defaultStylesheet: defaultChromeStylesheet` in the `layouts.show<ChromeLayout>('shell', { … })` call.

## The `?url` module type

`src/declarations.d.ts` declares `'*.css'` and `'*?raw'`, but no `'*?url'` (measured at plan time, re-verify). The
`'*.css'` pattern does not match a specifier that ends in `?url`. When `npx tsc --noEmit` reports the `?url` import as
an unresolved module, and no `'*?url'` declaration exists yet, add one beside the `'*?raw'` declaration in the same
style: a one-line comment ("Vite's `?url` suffix imports a file's URL."), then a module that default-exports a
`string`. Report it in the group's proof.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **Done when, added:** `grep -rn "defaultStylesheet: null" src` prints nothing, and each of the 16 owners has a
  `layouts/default/layout.css`. The field is `string | null`, so the compiler does not catch a `null` left behind.
- **Comments.** A comment above one rule moves with it. A split rule's comment is copied to both halves, each copy
  edited to name only its own subjects. A section label (`/* Card */`) goes with its first moved rule, and is
  repeated above the rules that stay in that section.
- **Sessions:** `.session-tabs-bar > *` stays in `sessions.css` (its subjects are kit-made children, and moving it
  would let it beat the later `.session-bar-parts` rule). Pin `.session-pane-body > *` as Stays for the same reason.
  Sessions is then Moves 35, Stays 25 (measured at plan time, re-verify).
- **Known ties for task 07's sweep.** A moved rule now wins every tie against bundled CSS. Name these in the Proof
  so task 07 check 5 covers them: settings `.settings-head` against `.ui-section-header` (`justify-content`), and
  notes `.notes-markup-group .is-active` against `.ui-icon-button.is-active` (background and colour). Any other tie
  the implementer finds goes in the Proof too.
- **First paint.** The default link now loads after the first draw can start, so a surface may draw once unstyled
  before its CSS loads. This is accepted; task 07 check 5 judges it on screen.

## Proof

Commit f26de97e · proof: diff read over 9 slices; 16 layout.css files; css_conserve.py per owner: base rules == page CSS + layout.css, lost 0 added 0 for all 16; no defaultStylesheet: null in any show call (test fixtures only); ?url declared; typecheck clean outside src/main (task 04 WIP); layers clean; check-styles and oxfmt flag only the pre-existing agent-strip min-height calc, moved verbatim to agent-strip/layouts/default/layout.css:11 · concerns: cascade ties for task 07 check 5: settings .settings-head vs .ui-section-header (justify-content), notes .notes-markup-group .is-active vs .ui-icon-button.is-active; to look at: agent-strip box vs kit rules, shell .activity-item and .config-problem-badge vs shared button rules, settings .settings-row vs .ui-row if a row ever takes ui-row, sessions .ui-row.session-row:not(.is-selected) vs .ui-row hover background; docs layout.css holds two consecutive .docs-doc-frame rules from the split, unmerged
