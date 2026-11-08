# 06 — Item descriptions and preview notices

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are relative to the gui worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`.
`F` = `src/plugins/forms`.

Files:     modify `F/main/kinds/notice/notice-format.ts` · modify `F/main/kinds/finding/finding-format.ts` ·
           modify `F/main/tool-definitions.ts` · modify `F/main/preview/preview-round.ts` ·
           test `F/main/preview/preview-round.test.ts`
Consumes:  `PREVIEW_ROUND_ARGS.questions` with `summary` in place of `question` ← 01 (01 edits the questions of
           `preview-round.ts` in Wave 1; this task edits only its `notices` array)
Produces:  `NOTICES_DESCRIPTION` (notices last, one line each, on one page) in `F/main/kinds/notice/notice-format.ts`
           `FINDINGS_DESCRIPTION` ("before the questions") in `F/main/kinds/finding/finding-format.ts`
           `ASK_ROUND_DESCRIPTION` (the `forms.md` pointer line, notices last) in `F/main/tool-definitions.ts`
           `PREVIEW_ROUND_ARGS.notices`: three notices, badges `Applied`, `Dispatched`, `Decided` in that order, in
           `F/main/preview/preview-round.ts`
Decisions: notices page goes last (round 3) · each notice is one line that opens to its context and its comment box
           (round 2) · agents reach the wording guidance by a pointer and a backstop; the `ask_round` description
           points to `~/wigley-agents/forms.md` (round 1, choice 3) · stale "notices first" wording is fixed in the
           tool descriptions (round 4, Decided) · the preview shows every badge (map § 6, Decided)

## Pinned values

Write each string below verbatim. The code splits a long string over `+`-joined lines, as the file does now; the
split points are free.

**`NOTICES_DESCRIPTION`** (now: "Each draws as its own card before the findings and questions, …"). After:

```
Fixes already made, dispatched, decisions you took alone, or anything otherwise settled before this round opened — one object per notice. Each draws as one line, its badge and title, on the round's notices page, after every finding and question; the line opens to its context and one comment box. Each is badged 'Applied', 'Dispatched' or 'Decided', and has no choices, no recommendation, nothing for the user to decide.
```

**`FINDINGS_DESCRIPTION`**: replace only `after the notices and before the questions` with `before the questions`.
The sentence becomes `Each draws as its own card before the questions; its origin sets the card and the fields it
takes.` Keep every other sentence.

**`ASK_ROUND_DESCRIPTION`**:

1. Insert this sentence directly after `Send every item whose prerequisites are already settled in one call.`:
   `How each item's text is worded: ~/wigley-agents/forms.md.`
2. Replace the notices clause. Now:
   `each one draws as its own card before the findings and questions, badged 'Applied', 'Dispatched' or 'Decided',
   with only a comment box — no choices and nothing to decide.`
   After:
   `each one draws as one line on the round's notices page, after every finding and question, badged 'Applied',
   'Dispatched' or 'Decided', and opens to its context and one comment box — no choices and nothing to decide.`
3. Keep every other sentence. No other sentence in it states an item order (checked at plan time).

**`PREVIEW_ROUND_ARGS.notices`**: three objects, in this order. Keep the existing `Decided` notice as the third,
unchanged.

| # | `title` | `context` | `badge` |
|---|---|---|---|
| 1 | `Rail entries show their full title on hover` | `':::tree\nRail\n  + each entry shows its full title on hover\n:::'` | `'Applied'` |
| 2 | `Long choices wrap under their number` | `':::changes\n~ a long choice wraps under its number instead of running off the card\n:::'` | `'Dispatched'` |
| 3 | `Kept the sidebar on the left` | `'Decided to keep the sidebar on the left, since every mode already puts its list there.'` | `'Decided'` |

Update the file's header comment so it names the three notices: one per badge.

## Tests

- `F/main/preview/preview-round.test.ts`, the one test in it. It pins the notices with
  `expect(round.notices.map((notice) => notice.badge)).toContain('Decided')`. Change that line to
  `expect(round.notices.map((notice) => notice.badge)).toEqual(expect.arrayContaining(['Applied', 'Dispatched', 'Decided']))`,
  which catches a preview that drops a badge. Rename the test to
  `parses, and holds every card kind, every notice badge, grouped choices and action reasons`.
- No test pins the description strings (checked at plan time: `grep` of `F/main` tests for the order wording
  finds nothing). Add no test for them: a description is copy, per `wigley:writing-tests` § What earns neither.

GIVEN the preview round WHEN `parseRound(PREVIEW_ROUND_ARGS)` runs THEN it parses, and its notices carry the
badges `Applied`, `Dispatched` and `Decided`.

## Other order wording in `F/main` and `F/page`

A grep at plan time (`notices first`, `before the findings`, `after the notices`, `notice…first`) found these hits.
Only the first three are this task's files:

| Hit | Owner |
|---|---|
| `F/main/kinds/notice/notice-format.ts:48` `draws as its own card before the findings and questions` | this task |
| `F/main/kinds/finding/finding-format.ts:111` `after the notices and before the questions` | this task |
| `F/main/tool-definitions.ts:28` `each one draws as its own card before the findings and questions` | this task |
| `F/page/form-state.ts:414-415` comment on `firstAnswerablePosition`: `Where a round opens: its first finding or question, past the notices; the first notice when it has nothing to answer.` | task 04, which rewrites the opening focus; this task does not edit `form-state.ts` |

`F/layouts/` holds no hit. Run the grep again after the edit:
`grep -rniE "notices first|before the findings|after the notices|past the notices" src/plugins/forms/main src/plugins/forms/page`.
Expect two hits until task 04 lands, both owned by 04, which this task leaves alone: the `form-state.ts` comment over
`firstAnswerablePosition` and the test title `'focuses the first finding or question, past the notices'` in
`F/page/form-state.test.ts`. List the test title in the table above too.

Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs `F/main/preview/preview-round.test.ts`
and `F/main/tool-definitions.test.ts`.
Commit:    one commit for the group, in the gui worktree.

## Proof

