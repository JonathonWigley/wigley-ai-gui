# 12 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 11
Plan: [plan.md](plan.md)

Risk: **High** (`~/wigley-agents/decisions.md` § Risk): the lane changes the forms tool contract every agent session
uses, saved round files, and the settings and keymap config main serves on every start. So the gate runs the picked
tests and the live checks below; no whole suite and no whole self-test run (AGENTS.md § Running and testing: a whole
self-test runs only when the user asks in the current turn).

Every live check here is one the tasks deferred by name. Each is tagged **expected** (the change doing what it was
made to do, seen live) or **low-confidence** (where a bug is likely: wiring or engine behaviour no test reaches), with
its reason. A claim a task's test already pins is not here.

Files: none edited, except a self-test step or fixture a check below needs and does not have yet, added to that
plugin's `main/selftest-script.ts` in its own commit, and a fix for a failure found here (then re-run the failed
checks and the tests the fix touches).

## Test gate

Run the tests every task added or edited, by file, with `npm test -- <files>` (the run log's Test gate lists them per
group; re-read each group's diff to pick, per `wigley:writing-tests` § Picking tests for a gate). Then
`npm run lint` and the type check once over the tree. In the marketplace: `python3 -m pytest
plugins/wigley/scripts/retro` and `python3 scripts/check_manifests.py` (09).

## Filtered self-tests

`npm run selftest -- --plugin <id>` for each plugin the lane touched: `forms`, `settings`, `chat`, `docs`,
`practice`, and `markdown-blocks` if 01 gave it a script (keys has no script: its checks run in the drive run). Each must pass as it does on `main`.

## Live checks

Through the drive run (`.agents/skills/drive/SKILL.md`) or a self-test step, whichever reaches the check; a screenshot
is checked against `DESIGN.md`.

Markdown blocks (01):
1. **Expected.** Chat and forms draw `:::changes`, `:::tree` and `:::details` as before, and an unclosed block draws
   while a reply streams. The adapter tests pin the bytes; streaming is only live.
2. **Expected.** Settings' Plugins section shows markdown-blocks locked on by Chat and Forms; switching it off is
   refused. Wiring only.

Ex commands (02):
3. **Expected.** `:w`, `:q`, `:q!`, `:wq` and `:x` work in a docs, a Practice and a Settings document editor, and do
   nothing in a box. No host unit test exists (vitest has no `EditorView`).
4. **Low-confidence.** A dev user-plugin fixture defines an ex command: it runs with the right editor, and after the
   plugin stops, vim's earlier command of that name is back. The restore rests on engine internals nothing has
   verified.

Remaps (03):
5. **Expected.** A dev user plugin with `keys.remaps` loads; the remap acts in an editor and help lists it.
6. **Low-confidence.** Switching that plugin off removes its remap and the default's remap for the same keys acts
   again. New layering in the served config (lead ruling).

Setting control kinds and the layout picker (04, 05):
7. **Expected.** The number box and theme picker self-test groups pass on the registered kinds.
8. **Low-confidence.** The `layout picker` self-test group: the fuzzy first row for `shelllayout`, and Escape closing
   the picker. Not run at plan time.
9. **Low-confidence.** A new `layouts/docs/<name>/layout.js` shows in the open picker without a reload. The service's
   announce-on-add path was not traced end to end.
10. **Low-confidence.** The `layout-picker` screenshot against `DESIGN.md`. Nothing visual checked yet.

Forms kinds (06, 07):
11. **Expected.** A round with all three built-in kinds saves a body whose keys and bytes match a file saved before
    06, and draws the same as before (rail, review, boxes). The boxes' hide rule is now general.
12. **Expected.** A draft autosaved by the installed app before this change restores in the new build.
13. **Expected.** An open round stays open while a plugin kind registers (the tool re-contribution keeps forms
    sessions).
14. **Low-confidence.** After the re-contribution, the host fetches `tools/list` again on `list_changed` and shows the
    new `ask_round` property. Depends on Claude Code's handling of the notice.
15. **Low-confidence.** A user plugin's page kind with no layout builder draws `default`'s `other` card. Needs a
    fixture plugin with both halves.
16. **Low-confidence.** Switching a kind's plugin off with a round open toasts and hides its items; switching it on
    brings the answers back. Depends on the live order parts start and stop.

Finding origins and proof (08, 09):
17. **Expected.** The four origin chips keep their colours.
18. **Expected.** A live round with a `caused` finding and no proof opens; the published `proof` and description text
    match what 08 pins.
19. **Expected.** A retro digest of a round the new build saved shows the card's words for the pick and the
    recommendation.
20. **Low-confidence.** A plugin origin registered at runtime reaches a live session's tool list (06's publish path).

Split (10):
21. **Expected.** The self-test's `[forms] event viewChanged …` line still prints, and forms keys work in
    `forms.forms` and `forms.review`.

Record each check's result in the Proof: pass, or the failure and its fix.

## For the wrap-up

- The user's installed app (Auri) still requires `proof` on every finding until the user installs a ref holding 08,
  while 09's text already tells agents to leave it out off a Nit. The wrap-up names `npm run install-app` (or the
  `install` skill) as the step that closes that gap.
- Checks only the user's hands or eyes settle go in the wrap-up with their steps, not here.

Done when: the test gate and filtered self-tests pass, and every live check above is recorded.

## Proof

