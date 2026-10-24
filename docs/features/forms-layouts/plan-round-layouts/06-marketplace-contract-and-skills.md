# 06 — Marketplace contract and skills

Status: done
Type: Batch
Wave: 5 · Depends on: 02, 04
Plan: [plan.md](plan.md)

All paths are in `D:\ai-dev\wigley-ai-marketplace` (`../wigley-ai-marketplace` from the app repo).

Files:     modify `plugins/wigley/scripts/forms/README.md` · modify `plugins/wigley/skills/review/triage.md` ·
           modify `plugins/wigley/skills/make/SKILL.md` · modify `plugins/wigley/scripts/retro/answers.py`
           (`_action_pick`, `_action_label`) · test `plugins/wigley/scripts/retro/tests/test_answers.py` ·
           modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the landed `ask_round` contract of 02, read from the code, not from this plan:
           `ROUND_FIELDS` and `parseRound` in `src/plugins/forms/main/round.ts` (round `layout`); each format's
           fields and `fingerprintContent` in `src/plugins/forms/main/kinds/{question,finding,notice}/*-format.ts`
           (item `layout`, choice `action`, `action_reasons`, optional `recommend`); the unknown-layout error text
           02 throws; the tool description in `src/plugins/forms/main/tool-definitions.ts` ← 02
           the landed payload and body rules of 04: `findingEntries(finding)` in `src/plugins/forms/finding-pick.ts`
           (the card's numbering), and the `choice`, `choice_text`, `status`, `took_recommendation`, `action` and
           `took_action_recommendation` values `findingResult` in `src/plugins/forms/main/round.ts` and `buildBody`
           in `src/plugins/forms/page/form-state.ts` give a pick ← 02, 04
           the forms plugin data folder: `<Electron userData>/plugins/forms/` (`dataFolder` in `src/main/main.ts`)
           and its `layouts/<name>/layout.js`, optional `layout.css`, and the `layouts/layout.d.ts` the app writes
           at each start ← the tree, and 01 for watching every folder
           `completeFindingPick(finding, choice, action)` in `src/plugins/forms/finding-pick.ts` (the rule retro's
           `_action_pick` copies) ← 02, 04
Produces:  in `README.md` § The two tools: the round's and each item's optional `layout`; a finding choice's
           optional `action`; a finding's optional `action_reasons`; `recommend` optional when the recommended action
           has no choices; the grouped, numbered card; a header pick's `choice` `0`; and a new sub-part **Layouts**,
           the single source of the rule for naming or writing a layout
           in `README.md` § Saved rounds: the `finding_answers` rules for a grouped pick, and the fingerprint
           sentence naming what it leaves out
           in `triage.md` § Building a round: the `choices`, `recommend`, `recommend_action` bullets rewritten, a new
           `action_reasons` bullet, one `layout` pointer line to the README's Layouts; § Reading back: the
           `choice` `0` reading
           in `make/SKILL.md` step 8: the grouped pick, choice `action`, `recommend` and `action_reasons` rules
           in `retro/answers.py`: `_action_pick` and `_action_label` read a finding pick by the card's entries (see
           § retro/answers.py); their signatures stay
           in both manifests: `"version"` one patch above the version `HEAD` holds when the task starts
Decisions: the marketplace docs land after the app code, in one commit with the version bump (plan.md, Docs
           written ahead): a skill that sends `layout`, a choice `action` or `action_reasons` before the app accepts
           them fails every such round
           the README holds the layout rule once, because it is the tool contract every skill already points at;
           `triage.md` points at it in one line; make step 8 gets no layout line, since it already builds its round
           "through review 8.1's hook … (triage.md's Building a round)", which carries the pointer
           `action_reasons` carries one entry, for the recommended action, only when that action is `follow_up` or
           `leave_it` (app AGENTS.md, A finding origin: "which a round carries only when it recommends that action");
           the app accepts an entry for any action the origin offers, and the skills ask for less than the app takes
           the patch number goes up (1.9.2 → 1.9.3 at plan time): the last plugin release (`46ef0e34`, 1.9.2) was a
           patch for a contract-adding change of the same size. The bump goes on top of whatever `HEAD` holds, an
           unpushed bump of another session included, since `AGENTS.md` (Changing a plugin) puts the bump in the
           series' last commit that changes the plugin, and an earlier commit is never rewritten
           retro reads a finding pick by the same rule as the app (02's `completeFindingPick`, 04's `findingEntries`),
           since it reads the files the app saves; a file saved before this change is read by the new rule too (one
           user, no backwards compatibility: app `AGENTS.md`, Intent)
           the commit stages only this task's seven paths; a peer's uncommitted edit stays as it is (see Before
           editing)
           the agent never pushes: the reply says the commit waits for the user's push

## Before editing

1. Run `git -C ../wigley-ai-marketplace status --short` and `git -C ../wigley-ai-marketplace log origin/main..HEAD
   --oneline`. At plan time the tree held a peer's uncommitted `plugins/wigley/scripts/forms/start_app.py` and two
   unpushed commits (`db28c703`, `46ef0e34`, the second bumping to 1.9.2).
2. If any of the seven Files shows as modified or staged before this task touches it, it holds another session's
   edit. Stop and ask the user in a `wigley-forms` round (and in one chat line, for the auto-mode classifier) whether
   to wait for that session's commit or to edit on top of the file and commit only this task's hunks with
   `git add -p`. Recommend waiting. Never commit or revert another session's edit.
3. Read the seven Files in full, and the 02 and 04 code the Consumes line names. Every statement below is written to
   that code's behaviour. Where the code differs from this task's wording, the code wins and the report names the
   difference.

## README.md

Write to `wigley:writing-for-agents`. Keep the README's Contents list true: give **The two tools** entry the words
"layouts" and "grouped finding answers".

§ The two tools, `ask_round`:

- Round fields: add the optional `layout`, a layout name. Each question, finding and notice object also takes an
  optional `layout`. Change "exactly six required fields" (questions) and "two required fields … and one optional
  field, `badge`" (notices) to name the optional `layout`. Change line 79's "No other field is accepted" so the list
  of accepted fields is still complete.
- Which layout draws what: a card comes from the first layout that defines its kind among the item's `layout`, the
  round's `layout`, the user's `forms.layout` setting and `default`; the head, rail and review panes the same way
  without the item. A name that is not a folder in the layouts folder fails the call, and the error lists the names
  the folder holds (use 02's text as the example). `default` is always a valid name.
- Finding choices: each choice is `text`, `reason` and an optional `action` (`fix_now` when left out). State the
  values 02 accepts for a choice's `action` and the error for an action the origin does not offer.
- `action_reasons`: an optional object with `follow_up` and `leave_it` keys, each one plain sentence, accepted only
  for an action the origin offers (a Nit has no `follow_up`). The card shows it under that action's header.
- `recommend`: the 1-based number of the recommended choice in the `choices` array as sent; that choice's `action`
  equals `recommend_action`. Left out when `recommend_action` names an action no choice carries (the error 02 gives
  for each wrong case).
- The card: replace the "action control" sentences (lines 62–63, 73–77, 79) with the grouped card. Every choice
  shows under the header of its action, in the action order `fix_now`, `follow_up`, `leave_it`, each offered action
  drawn once. Numbers run down the card, `1` first; an action with no choices takes one number on its own header.
  Picking a choice, or a bare header, sets the choice and the action together. The recommended entry is tagged
  Recommended; Accept takes it. Keep the rule that the app rejects a choice whose text opens with an action's label.
  Remove "A finding with one choice shows it as the fix, and the user picks only the action".
- The payload (lines 115–121): a finding's `choice` is the 1-based position in the `choices` array as sent, not
  the number on the card, and `0` when the user picked a bare action header; `choice_text` is then empty. Restate
  when a finding reads `answered`, `untouched` and what `action` holds, to 04's code (expected: any picked entry
  is complete, so the "`fix_now` among several solutions with none chosen" case is gone). State
  `took_recommendation` for a finding whose `recommend` was left out, to 02/04's code.

New sub-part **Layouts**, under § The two tools after the field list (the single source; nothing else repeats it):

- Where the layouts are: the forms plugin data folder's `layouts/` — on macOS
  `~/Library/Application Support/wigley-ai-gui/plugins/forms/layouts/`, on Windows
  `%APPDATA%\wigley-ai-gui\plugins\forms\layouts\`. A layout is a folder `<name>/` with `layout.js` and an optional
  `layout.css`; the app writes the contract, `layout.d.ts`, beside them at each start. A layout defines only the
  cards and panes it changes.
- Name a layout only when the round's look matters; a round with no `layout` draws in the user's own layout.
- An agent that wants a look no layout has writes a new layout folder, names it in the round or the item, and lists
  each layout it wrote or changed in a notice on that round: the notice's title names the layout, its `context` the
  file path. Reason: the user then sees the file while its look is on screen. The folder exists before the call,
  since an unknown name fails it.
- A re-send keeps the layouts the round opened with (layout names stay out of the fingerprint).

§ Saved rounds:

- The fingerprint sentence (lines 223–225): the hash covers the questions, notices and findings, every field but
  `layout`, and never the heading, the overview or the round's `layout`. State whether a choice's `action` and a
  finding's `action_reasons` are hashed, and whether an omitted `action` hashes as `fix_now`, to 02's
  `fingerprintContent`. Keep "A round with no findings hashes as it did before findings existed" only if 02's
  code keeps it true.
- `finding_answers` (lines 205–211): `choice` is the position in the `choices` array, `0` on a bare header pick;
  `action` is the picked entry's action. Remove "kept while the action is `leave_it`" and "A one-solution finding
  saves `choice` `1`" unless 04's `buildBody` still does that. Keep the meaning of the sentence on files saved
  before finding answers carried an `action` (retro reads those files), reworded so it no longer holds the words
  "action control", for example: "A file saved before finding answers carried an `action` has none: a reader treats
  it as none, and that file's choice labels carry the action they paired with a solution."

## triage.md (§ Building a round, § Reading back)

- `choices` bullet (lines 91–96): each choice is `{ text, reason }`, plus `action` only on a choice that is itself a
  way to defer — `follow_up` or `leave_it` — such as "Plan it as its own feature"; every fix leaves `action` out.
  Replace "what to do with it is the card's own action control" with: the card draws the action headers itself, so
  the text names the fix alone, and the app rejects a choice opening with an action's label.
- `recommend` bullet (line 97): the 1-based number of the recommended choice, which carries the recommended action;
  left out when that action has no choices, as a recommended Leave it on a finding whose choices are all fixes.
  It stops being "required".
- `recommend_action` sub-bullet "`leave_it` only when … naming why" (lines 105–106): the why goes in
  `action_reasons.leave_it`.
- New bullet after `recommend_action`: `action_reasons` — one plain sentence for the recommended action, only when
  that action is `follow_up` or `leave_it`: why to defer or drop it. It shows under that action's header.
- One new line after the Findings bullets: "`layout` stays out of a round unless its look matters; how to name or
  write one is the forms README's Layouts ([`scripts/forms/README.md`](../../scripts/forms/README.md))."
- Line 121, "(make step 8 holds the layout)": change "the layout" to "that round's shape", so it does not read as
  the new `layout` field.
- § Reading back, first bullet (lines 137–141): `choice` `0` means the user picked a bare action header — the action
  with no solution. The `follow_up` bullet (lines 146–150): append the item naming the chosen solution, or every
  solution when `choice` is `0`.

## make/SKILL.md (step 8)

- Replace "so the user reads the item, picks a solution, then picks an action on the card's action control" with:
  the user picks one entry, a choice or a bare action header, which sets the solution and the action together.
- After "Each choice's `text` … and its `reason` …": a choice that is itself a way to defer carries `action`
  `follow_up` or `leave_it`; every other choice leaves `action` out (`fix_now`).
- Replace "`recommend` names the recommended solution and `recommend_action` the recommended action, each per …"
  with: `recommend_action` names the recommended action and `recommend` a choice that carries it, left out when that
  action has no choices; `action_reasons` carries one sentence for the recommended action, only when it is
  `follow_up` or `leave_it`; each per `~/wigley-agents/decisions/triage.md`.
- The `follow_up` sub-bullet: "naming the chosen solution, or every option when `choice` is `0`".
- No layout line (Decisions).

## retro/answers.py (`_action_pick`, `_action_label`)

Today `_action_pick` (about lines 211-231) reads a pick by the old rule: a `fix_now` or `follow_up` pick with no
in-range choice is no pick on a multi-choice finding, the same pick reads as solution 1 on a one-choice finding,
and `_action_label` gives a `follow_up` recommendation with no `recommend` the label `Follow-up — choice 0`. The new
rule, written to 02's `completeFindingPick` and 04's `findingEntries` as they landed:

- The card's entries: the actions the finding's origin offers (the keys of its `ORIGIN_ACTION_LABELS` row; all
  three for a missing or unknown origin), in the order `fix_now`, `follow_up`, `leave_it`. Under each, its choices in
  `choices` order (a choice's `action`, `fix_now` when absent), each the entry `(choice number, action)`; an action
  with no choices is one header entry `(0, action)`.
- A pick is complete when its `(choice, action)` is one of the card's entries: a choice, or a bare action header
  with `choice` 0 for an action with no choices. Any other pick, and a not-applicable answer, is no pick, as today.
  The one-solution leniency (choice 0 read as solution 1) goes.
- `_action_label(item, action, choice)`: the card word for the action, then ` — ` and the choice's label when
  `choice` is 1 or more, `leave_it` included (a `leave_it` choice is a solution). A header pick (`choice` 0) labels
  the action alone. The recommended label is `_action_label(item, recommend_action, recommend)`, with a missing
  `recommend` read as 0, so it also labels the action alone.
- An override is a complete pick whose `(choice, action)` differs from `(recommend or 0, recommend_action)`.
- Update both docstrings to the new rule. `_choice_pick` (questions and old-format findings) does not change.

`retro/tests/test_answers.py`, in `AcceptedListingTests`:
- new `test_a_new_format_header_pick_labels_the_action_alone` — a caused finding with two `fix_now` choices,
  `recommend: 1`, `recommend_action: 'fix_now'`, pick `(0, 'follow_up')`: an override line whose pick label is
  `Follow-up` and whose recommended label is `Fix now — <choice 1's text>`
- new `test_a_new_format_recommended_header_with_no_recommend_is_accepted` — no `recommend`,
  `recommend_action: 'leave_it'`, pick `(0, 'leave_it')`: `accepted · <title> | Leave it`
- new `test_a_new_format_follow_up_choice_labels_its_text` — choice 2 carries `action: 'follow_up'`, pick
  `(2, 'follow_up')`: the pick label is `Follow-up — <choice 2's text>`
- new `test_a_new_format_choice_picked_under_another_action_lists_no_pick` — pick `(1, 'follow_up')` where choice 1
  is `fix_now`: no line
- `test_a_new_format_action_on_a_one_solution_finding_takes_that_solution` is replaced by
  `test_a_new_format_header_pick_of_an_action_with_choices_lists_no_pick` — pick `(0, 'fix_now')` on a one-choice
  finding: no line
- the other new-format cases whose fixture breaks 02's rules (a pick of a choice under another action, a `recommend`
  naming a choice of another action) take a fixture the app now sends and keep their claim

Test command, from the marketplace root: `(cd plugins/wigley/scripts/retro && python3 -m unittest discover)`.

## Version bump

Read `"version"` in `plugins/wigley/.claude-plugin/plugin.json` as `HEAD` holds it and raise its patch number by one
in both manifests (1.9.2 → 1.9.3 at plan time). Both files keep the same `version`.

GIVEN the seven edits WHEN `grep -n "action control" plugins/wigley/scripts/forms/README.md
plugins/wigley/skills/review/triage.md plugins/wigley/skills/make/SKILL.md` runs THEN it prints nothing
GIVEN the README WHEN `grep -n "action_reasons\|layout" plugins/wigley/scripts/forms/README.md` runs THEN it lists
the field lines, the Layouts sub-part and the fingerprint sentence
GIVEN a saved round whose finding answer is a bare Follow-up header pick (`choice` 0, `action` `follow_up`) on a
finding with no `follow_up` choice WHEN retro lists it THEN the pick reads `Follow-up`, not no pick and not
`Follow-up — choice 0`
GIVEN `git diff --cached --name-only` before the commit THEN it lists exactly the seven Files
Tests:     the `test_answers.py` cases in § retro/answers.py, run by
           `(cd plugins/wigley/scripts/retro && python3 -m unittest discover)`. Every command under the marketplace
           `AGENTS.md` § Done runs and passes from the marketplace root, that one and
           `check_manifests.py --against origin/main` included (it proves the bump)
Done when: the seven Files hold the edits above, written to the landed 02 and 04 code; the retro tests and the Done
           commands pass; the commit holds only the seven Files
Commit:    one marketplace commit: `git add` the seven paths by name (never `-A` or `.`), then commit, for example
           "wigley 1.9.3: forms rounds name layouts, finding choices carry actions, action_reasons; retro reads the
           grouped pick". No push; the reply says the commit waits on main for the user's push

## Proof

Commit f402c1eb (marketplace) · proof: diff read; retro suite 162 tests OK; check_manifests passes (worker); forms Python suite's 12 relay/nvm failures pre-exist on this machine, fingerprint test passes · concerns: README now states the app's at-least-one fix_now choice rule, which the plan never named; nit plain-label test's claim moved to no-pick since no valid pick reaches the fallback; other marketplace suites fail identically at HEAD on Windows/Git Bash
