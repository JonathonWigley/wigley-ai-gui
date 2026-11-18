# 09 — Retro reads action words; proof text in the marketplace and forms.md

Status: done
Type: Batch
Wave: 5 · Depends on: 08
Plan: [plan.md](plan.md)

Two folders of the `ai` repo outside wigley-ai-gui. `MKT` is `/Users/jonathonwigley/Documents/ai/wigley-ai-marketplace`; `AGENTS`
is `~/wigley-agents` (`/Users/jonathonwigley/Documents/ai/wigley-agents`). Each lands through
`~/wigley-agents/WigleyRepos.md` § Landing: one worktree for every folder the session changes, a fast-forward into `main`, then the push. Read
`MKT/AGENTS.md` first. Tree facts were read at plan time (2026-11-09).

## Files

MKT:

- modify `plugins/wigley/scripts/retro/answers.py`
- test `plugins/wigley/scripts/retro/tests/test_answers.py`
- modify `plugins/wigley/scripts/forms/README.md` — § The two tools, § Saved rounds
- modify `plugins/wigley/skills/review/triage.md` — § Building a round, the field list
- modify `plugins/wigley/skills/make/SKILL.md` — step 8's round text
- modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` — version

AGENTS:

- modify `forms.md` — § Findings, the `proof` bullet

## Consumes

- `FindingAnswerEntry.action_label: string` in each saved round's `body.finding_answers` entry ← 08: the card's word
  for the picked entry's action when the pick is one of the card's entries, else `''`; `not_applicable` does not
  change it.
- `FindingAnswerEntry.recommend_action_label: string` ← 08: the card's word for the finding's `recommend_action`, on
  every entry.
- The tool rule ← 08: `proof` is required on a `nit` finding alone; another origin accepts an absent, `null` or blank
  proof as none, and keeps a sent one; an omitted proof is left out of the fingerprint.

## Produces

- `answers.py` with no `ORIGIN_ACTION_LABELS`; `ACTION_LABELS` stays, as the generic word of each action value.
- `_action_pick(item: dict, answer: dict, not_applicable: bool) -> _Pick` and `_card_entries(item: dict) -> list`
  keep their signatures; their rules change as Decisions states.

## Decisions

- **Retro's pick rule for an entry that holds `action_label`.** A pick counts only when `action_label` is a non-empty
  string and `(choice, action)` is one of `_card_entries(item)`. Its `chosen` label is `action_label`, followed by
  ` — ` and the choice's label when `choice` is 1 or more.
- **The recommendation's label.** The recommended label uses `recommend_action_label` when it is a non-empty
  string; else (a file saved before 08) `ACTION_LABELS[recommend_action]`, else the action value itself. So every
  pick and override reads in the card's words.
- **Older files.** An entry with no `action_label` key was saved before 08. Retro labels its action with
  `ACTION_LABELS`, else the action value itself, which is today's `_action_label` fallback for an unknown origin.
  Reason: retro reads saved files back 90 days (`ledger.py` `STALE_DAYS`, README § Saved rounds), the app rewrites no
  file, and `answers.py` already reads every older saved shape (`what` and `why`, the solution-plus-action model).
  `MKT/AGENTS.md` sets no rule against such a reader; the app's no-shim rule (wigley-ai-gui `AGENTS.md` § Intent)
  covers the shapes the app writes, and the app writes nothing here. A Decision or Nit pick in an older file then
  reads `Follow-up` where its card showed `Plan it`; the analyst still reads the action.
- **Card entries.** `_card_entries` offers every action of `ACTION_LABELS` on every finding, as it does today for a
  missing or unknown origin. Retro has no origin table, and the app saves only picks that are entries. A new file's
  pick of an action the card does not offer saves `action_label` `''`, so the rule above lists no pick.
  `_solution_and_action_pick` (files from before the one-pick card) does not change.
- **Unknown result keys.** `answers.py` reads only `args.findings`, `args.questions`, `args.notices`,
  `args.heading`, `body.finding_answers`, `body.answers`, `body.notice_comments` and `body.note`, each through
  `.get()`. An unknown `args` or `body` key is ignored and raises nothing (checked at plan time in `_answers`,
  `_notice_comments`, `round_lines` and `_listing_block`). Task 06 needs no change here; one test row pins it.
- **Version.** `MKT/AGENTS.md` § Changing a plugin: every change to a plugin bumps `version` in both manifests, in the
  same commit. `2.12.3` at 2026-11-16 → `2.12.4`; when `origin/main` holds a newer version at landing, bump one patch
  above it.
- **Landing order.** The marketplace and `forms.md` text tells agents to leave `proof` out off a Nit, which the tool
  before 08 refuses. Land 09 only after 08's commit is on the `ai` repo's `main`. The user's installed app (Auri) still
  runs the tool before 08 until the user installs a ref that holds 08 (the `install` skill): the run's wrap-up names
  that install.
- **`forms.md` is the user's file in `~/wigley-agents`.** The plan settled this edit with the user. Commit it as its
  own commit, in the same worktree, through § Landing.
- **Stale line found.** `triage.md`'s `nit` bullet says a nitpick goes as a `caused` or `pre_existing` finding with
  `recommend_action` `fix_now` "(Fix anyway)". On a Defect card `fix_now` reads "Fix now"; "Fix anyway" is the Nit
  card's word. The line changes to "(Fix now)".

## Pinned text

`answers.py` module docstring — the sentence from "the action labelled with the word its `origin`'s card shows" to
"does not offer." becomes: `the action labelled with the entry's \`action_label\`, the word the card showed for it
(scripts/forms/README.md § Saved rounds), or with ACTION_LABELS in a file saved before that field.` Then: `A pick that
is no entry, on a finding none of whose choices names an \`action\`, …` stays. The comment over `ORIGIN_ACTION_LABELS`
goes with it. `_card_entries`'s docstring: `each action of ACTION_LABELS, in that order, then …`. `_action_label`'s
docstring names `action_label` first, then `ACTION_LABELS`, then the action itself.

`scripts/forms/README.md` § The two tools — the paragraph "Every finding carries `title`, `origin`, `impact` …
`layout`." becomes:

> Every finding carries `title`, `origin`, `impact` (one plain sentence: what goes wrong, and for whom), `finding`
> (what is wrong; for a Decision, what is to decide), `choices` and `recommend_action`, and may carry `recommend`,
> `action_reasons`, `proof` and `layout`. A Nit also carries `proof`: why it cannot happen, drawn under Why it's safe.
> Another origin accepts `proof`, and reads an empty or `null` one as none; the default layout does not draw it there.
> A Defect also carries `severity` (`critical`, `important` or `minor`), and no other origin accepts it.

The sentence after it ("A finding missing a field its origin requires …") stays.

§ The two tools — the paragraph opening "The card shows `finding` and `proof`, then a verdict" becomes, its tail from
"then its entries, grouped:" kept:

> The card opens on a verdict the app composes from the origin, the severity and `impact`, then shows `finding`, and on
> a Nit its `proof` under Why it's safe, then its entries, grouped: …

§ Saved rounds — the `finding_answers` bullet gains, after "no pick saves `choice` `0` and `action` `""`.":

> `action_label` is the word the card showed for the picked entry's action (`Plan it` on a Decision's `follow_up`),
> `""` when the pick is none of the card's entries; it is set whatever `not_applicable` holds.
> `recommend_action_label` is the card's word for the finding's `recommend_action`, on every entry. A file saved before the
> field existed has none, and a reader labels the action with its Defect word.

§ Saved rounds — the fingerprint paragraph, after "and `recommend` only when sent.": `` `proof` is hashed only when
sent and not blank; every file saved while the tool required `proof` carries it, so its hash stays. ``

`skills/review/triage.md` § Building a round — the bullet "`impact`, `finding` and `proof`, the last one short line the default card does not draw" becomes:

> - `impact` and `finding`; and on a `nit` alone, `proof`, which says why it cannot happen. Every other origin leaves
>   `proof` out: the default card does not draw it.

and the `nit` bullet's "(Fix anyway)" becomes "(Fix now)".

`skills/make/SKILL.md` step 8 — "and its `finding` and `proof` state the item," becomes "its `finding` states the item
and it leaves `proof` out, since no item here is a `nit` (a Nit offers no Follow-up),".

`~/wigley-agents/forms.md` § Findings — the `proof` bullet becomes:

> - **`proof`** — on a `nit` alone: why it cannot happen, which the card shows under "Why it's safe". Every other
>   origin leaves it out; the tool accepts it there, but the default card does not draw it.

`forms.md` § Written fallback ("with a `nit`'s `proof` after it") stays: it is already true.

## Behaviour

- GIVEN a finding answer with `action_label: 'Plan it'`, `(2, follow_up)`, on a `design` finding recommending
  `(1, fix_now)`, with `recommend_action_label: 'Decide now'`, WHEN retro lists it THEN `- override · Cache layout |
  Plan it — Shared | recommended: Decide now — Per user`.
- GIVEN `(1, fix_now)` with `action_label: 'Decide now'` on that finding WHEN retro lists it THEN `- accepted · Cache
  layout | Decide now — Per user`.
- GIVEN `(0, follow_up)` with `action_label: ''` on a `nit` finding WHEN retro lists it THEN the round lists no pick.
- GIVEN an older entry with no `action_label`, `(2, follow_up)`, on that `design` finding WHEN retro lists it THEN
  `- override · Cache layout | Follow-up — Shared | recommended: Fix now — Per user`.
- GIVEN a round whose `args` holds an unknown list (`risks`) and whose `body` holds `risk_answers` WHEN `round_lines`
  and `accepted_listing` run THEN they give the known lists' lines and raise nothing.

## Tests

In `plugins/wigley/scripts/retro/tests/test_answers.py`, class `AcceptedListingTests`:

- `test_a_decision_finding_labels_its_actions_with_its_cards_words` becomes
  `test_a_pick_labels_its_action_with_its_saved_action_label`: the picked entry gains `"action_label": "Plan it"`;
  the expected line is the first Behaviour line.
- `test_a_nit_pick_of_an_action_its_card_does_not_offer_lists_no_pick` becomes
  `test_a_pick_saved_with_an_empty_action_label_lists_no_pick`: the picked entry gains `"action_label": ""`; the
  expectation stays.
- add `test_an_accepted_pick_labels_the_recommendation_with_its_saved_action_label` (second Behaviour line).
- add `test_an_entry_saved_before_action_label_labels_its_action_with_the_defect_word` (fourth Behaviour line).

In class `RoundLinesTests`: add `test_a_round_with_an_unknown_item_list_reads_its_known_lists` (last Behaviour line;
assert both functions' output for a round with one known finding beside the unknown keys).

Every other new-format test keeps its expectation: none of them has an `origin` outside `caused`, and the Defect words
equal `ACTION_LABELS`.

## Done when

From `MKT`'s root, per `MKT/AGENTS.md` § Done:

```
python3 scripts/check_manifests.py
python3 scripts/check_manifests.py --against origin/main
python3 scripts/check_pointers.py
claude plugin validate .
(cd plugins/wigley/scripts/retro && python3 -m unittest discover)
```

`check_pointers.py` also reads `~/wigley-agents`, so it runs after the `forms.md` edit. `grep -n ORIGIN_ACTION_LABELS
plugins/wigley/scripts/retro/answers.py` prints nothing. Live checks (a retro digest over a round the new app saved)
are task 12's ("Final verification").

## Commit

One commit per folder, all in the one `ai` worktree:

- MKT: `Retro reads each finding answer's action_label; proof is required on a Nit alone in the forms README, triage and
  make; bump to 2.12.4` — the version bump rides this commit.
- AGENTS: `forms.md: a finding's proof goes on a Nit alone`.

## Rulings from the plan's cold read

- **An entry with the `action_label` key is new-format.** A missing or empty label is no pick, and such an entry
  never reads through `_solution_and_action_pick`; only an entry without the key takes the older-file path. The
  empty-label test's finding has choices that omit `action`, so it fails if the old path runs.
- **One label builder.** The chosen and the recommended label come from the same builder, given the saved word
  (`action_label` or `recommend_action_label`), or none for the `ACTION_LABELS` fallback; the ` — <choice label>`
  suffix rule is unchanged.
- **Tests.** `test_a_pick_labels_its_action_with_its_saved_action_label`'s entry carries both `action_label: "Plan it"`
  and `recommend_action_label: "Decide now"`. Replace `test_an_accepted_pick_labels_the_recommendation_...` with an
  override case whose expected line shows `recommended: Decide now — Per user`, so the recommended label is read.

## Proof

Commit 2c5350abe, bf8ea4199 · proof: diff read: ORIGIN_ACTION_LABELS gone, _action_pick reads action_label/recommend_action_label with the pre-08 fallback, _card_entries offers every action; README, triage.md, make SKILL.md, forms.md proof text; both manifests 2.16.3 (main holds 2.16.2); retro unittest OK · concerns: check_pointers.py fails on a main-clone learning/candidates file this task did not touch; the doc's 2.12.4 version was stale
