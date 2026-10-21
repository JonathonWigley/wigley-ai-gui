# 11 — Doc re-read

Status: not started
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     modify `DESIGN.md` · modify `AGENTS.md` · modify `docs/features/ui-design/design.md` · modify
           `docs/features/followups.md` · modify `docs/features/agent-chat/design.md`,
           `docs/features/docs-browser/design.md`, `docs/features/plugin-framework/design.md` (their stale key
           lines, below) · the only plan C task editing `DESIGN.md`, `AGENTS.md` and `design.md` (plan.md)
Consumes:  the landed code of tasks 01–10 (read it; this task's Produces are doc lines, not code) · the run log's
           Rulings and each task's Proof concerns in this plan folder
Produces:  `DESIGN.md` § Colour naming `editor-active-line` and § Type / § Surfaces stating 09's decisions ·
           every line of `DESIGN.md`, `AGENTS.md` and `docs/features/ui-design/design.md` true of the code after
           01–10; `docs/features/followups.md` holding none of the items pulled into ui-design and every follow-up
           plan C found
Decisions: a doc line is corrected to the code, never the code to the doc, unless the code breaks a rule `DESIGN.md`
           states on purpose — that goes in the report as a defect instead (DESIGN.md: "fix the code, or change
           this file on purpose") · `design.md` § Keys and § Surfaces turn from planned changes ("move to",
           "go") into the rule as it stands, each key named as landed; the reasons stay · the feature designs of
           earlier features (`agent-chat`, `docs-browser`, `plugin-framework`) are decision records: their stale
           key line is rewritten to today's keys with `(changed by ui-design plan C)` after it, the rest left alone
           (drafter: AGENTS.md's user rule fixes a stale doc wherever found, and a record keeps its history) ·
           every edit follows `wigley:writing-for-agents` (AGENTS.md is read by agents)
Done when: each row below is checked against the code and each mismatch corrected; `grep -rn 'Space c m\|Space c e\|Space c o\|Space c c\|Space e n\|Space e p\|Space Enter\|jumpTo\|Space a 1\|<Leader>1-9\|legacy list\|no-legacy\|<leader>N\|<leader>en\|<leader>ep\|tree hidden\|toggle the tree' AGENTS.md DESIGN.md docs/features/ui-design/design.md docs/features/followups.md docs/features/agent-chat/design.md docs/features/docs-browser/design.md docs/features/plugin-framework/design.md`
           prints only lines that name the old key as history (`replacing …`, `changed by …`); `npm run lint` passes;
           the report lists each line
           changed, with its file and section
Commit:    one commit for the group: `Docs match plan C's surfaces and keys; follow-ups updated`

## What to check, line by line

Read each doc whole; the rows are where plan C's code lands, not the limit of the read.

| Doc · section | Claim to check against the code |
|---|---|
| `DESIGN.md` § Layers | the diagram's L1 side bar "sessions / docs tree" and L3 "composer, picker"; the table's L2 row naming "the forms rail" (04 lands it as a split pane) |
| `DESIGN.md` § Keys and focus | each example as landed: raw `c` clears the focused item's choice (05), `m` opens the chat's mode picker (07), `<A-o>` next tab, `<A-n>` next unanswered item (05), `<C-l>` focuses the doc pane (docs), `Space k s`, `Space z …`; `<Leader>a…` kept in a forms box (05); the focus ring as 01–09 draw it; buttons never take focus |
| `DESIGN.md` § Surfaces | title bar, activity bar, side bar, tabs, status bar (01, 03); Forms: the rail a split's start pane, cards on `card-background` with `radius-md`, the recommended choice in the accent (04); Chat: user turns, tool cards with a status dot and no duration, permission cards with **Allow once** / **Deny**, the floating composer with chips and send (06); Docs: tree in Docs mode's side bar, the start pane of a split in a session's Docs tab, prose and code blocks (08, 09); Floating: pickers, which-key, help, dialogs over `scrim` (01, 02); empty states as landed (the doc pane's `Open a doc from the tree`, 08); splits keep widths |
| `DESIGN.md` § Colour | the **Text selection, cursor** row: tokens `selection-background`, `cursor`, `editor-active-line`; use: Catppuccin convention; the active line's band in a focused document editor (09) |
| `DESIGN.md` § Type and § Surfaces | 09's decisions stated: rendered markdown is prose at `text-14` / `leading-prose` / `prose-measure` everywhere it renders, forms cards and chat included (no surface overrides it); the active-line band shows only in the docs document editor, only while it has focus, never in a text box (a box's focused frame marks it); code blocks solid `block-background` with no border |
| `DESIGN.md` § Checks | check-styles judges every file under `src/` (10): every mention of the legacy list or `--no-legacy` goes; the screenshot names plan C's tasks added (`docs-kind-picker`, `docs-completion`, `docs-session-tab`, all from 08) |
| `AGENTS.md` § Architecture tree | `docs/` line: "page/ (one docs view — tree, rendered doc, document editor — …)" says the view hands back its tree and its doc: the tree in Docs mode's side bar and in the start pane of a split in each session's Docs tab |
| `AGENTS.md` § Architecture, mode bullet | `Space k d` pressed while Docs shows toggles its side bar, as Sessions' `Space k s` does (08) |
| `AGENTS.md` § Architecture, session tab bullet | tabs and the Form tab as 03 and 04 land them; `Option+o` / `Option+i`, `Option+Shift+o` / `Option+Shift+i` unchanged |
| `AGENTS.md` § Architecture, key bullets | every key named is a bind in the merged keymap; the text-box sentence ("a chord bind fires inside a text box", docs' `textBoxInput`) as landed; the editor-key sentence names the insert key(s) the code binds (today only `<CR>`) |
| `AGENTS.md` § Architecture, key hints | "every forms button whose command has a page bind" draws its Kbd through `keysFor` (04, 05) |
| `AGENTS.md` § Architecture, item kind / finding origin | the card input and kit parts in `layouts/layout.d.ts` as 04 changed them; `Accept (Enter)` and the recommended choice's mark |
| `AGENTS.md` § Architecture, session control | `Space c m` / `Space c e` / `Space c o` / `Space c c` become raw `m` / `e` / `o` / `c` in the chat scope, with `<Leader>cm` / `ce` / `co` / `cc` kept in the composer box, where raw keys are vim's (07); chat's `gg` beside `G` |
| `AGENTS.md` § Architecture, forms layout | the kit's parts listed as 04 landed them — `card`, `tag`, `kbd`, `button` (variant and `keys`), `sectionHeader` beside the existing parts; `Space z l n` / `p` / `c` / `o` unchanged |
| `AGENTS.md` § Architecture, chat layout | the chat kit's parts listed as 06 landed them — `collapsibleCard`, `card`, `statusDot`, `setDotStatus`, `sectionHeader`, `permissionActions` (Allow once / Deny), `expander` now a collapsible card |
| `AGENTS.md` § Running and testing | the self-test steps and screenshots plan C added are covered by the generic sentences; a sentence naming a step that moved (forms' jump keys, docs' tree toggle) is corrected |
| `design.md` § Plans | plan C's line names what landed |
| `design.md` § Shell | "`Space k s` / `Space k d` keep toggling it. Sessions puts its session list there; Docs mode puts its tree there" as landed |
| `design.md` § Surfaces | the table's rows and the three notes as landed (layers, composer radius and inset tokens, Allow once / Deny, the accent on the recommended choice) |
| `design.md` § Keys | the list rewritten from changes to the rule as it stands: forms' raw `c` `f` `u` `s`, `<A-n>` / `<A-p>`, `<D-Enter>`, no jump-to-question; chat's raw `m` `e` `o` `c` and `gg`; docs' `gg` / `G` in the tree; session rows on `<A-S-o>` / `<A-S-i>`; "docs already follows the rule" kept only if still true |
| `design.md` § Out of scope | each item still a follow-up in `followups.md` |
| `docs/features/agent-chat/design.md:120` | the Controls line names raw `m` `e` `o` `c` in the chat scope and `<Leader>c…` in the box |
| `docs/features/docs-browser/design.md:33` | `Space k d` pressed while Docs shows toggles Docs mode's side bar, which holds the tree |
| `docs/features/plugin-framework/design.md:83–85` | `<leader>N` jumps to question N (83): gone, no jump to question; `<leader>en` / `<leader>ep` (84): now `<A-n>` / `<A-p>`, page and box; `<leader>a<digit>` / `<leader>ac` (85): kept in a box, the page's `Space a` binds gone for raw digits and raw `c` `f` `u` `s` (05) |

Line numbers measured at plan time, re-verify.

## Follow-ups (`docs/features/followups.md`)

- **Pulled into ui-design, gone from the list:** the user config file, settings and keymap hot reload, the layered
  keymap, the shell registry, plugin-declared theme tokens, the platform chord formatter, the active-line band, the
  sessions-mode live checks, the forms-layouts live checks. Check each is absent (commit `e1f6b73` removed them; a
  later edit may have brought one back) and that the file's opening sentence names them as landed in plans A–C, not
  as planned.
- **Still follow-ups, kept:** command palette, Latte and OS light/dark, native vibrancy and mica, per-tool-call
  duration, layouts as a core service, the full `Platform` record, the runtime plugin loader and unloading every
  registration (`design.md` § Out of scope). An item a plan C task resolved goes, named in the report.
- **Stale wording:** "`PAGE_LEADER_KEY = ' '` in keys (left over from the layered keymap, which `ui-design` plan A
  lands)" and "Builds on the user config folder (`ui-design` plan A)" read as landed facts; the "Commands take a count
  or argument" item drops `jumpTo` if it still names it (05 removed the commands).
- **Added:** every follow-up the run log's Rulings or a task's Proof concerns name as deferred, one entry each with
  its sites; among them, from drafting: a session Docs tab's tree has no key to hide it (08). The narrow Sessions
  overlay's row-click question is answered in 12, which records it.

## Proof
