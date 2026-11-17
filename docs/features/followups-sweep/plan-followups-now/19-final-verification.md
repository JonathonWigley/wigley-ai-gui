# 19 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: every group (runs after `wigley:make`'s test gate)
Plan: [plan.md](plan.md)

Files: none (checks only; a fix a check calls for goes back to its group).

Run every check in one live session of the app, driven offscreen through the `drive` project skill
(`.agents/skills/drive/SKILL.md`). Self-test runs are filtered, one plugin at a time
(`npm run selftest -- --plugin <id>`), never the whole suite. The user's own app is never touched. Each check names
the group whose landing it proves, and its tag: **expected** (the change is straightforward; a failure is a bug in the
group) or **low-confidence** (the reason is given; a failure is first re-checked for setup before it is called a bug).

## Checks

1. **03, drive quit waits** (low-confidence: the host's end is hard to reproduce on demand). In a drive run:
   `quit --keep-sessions`, then `start --run <id>` on the same run, then a plain `quit`. The quit waits on the session
   host, then either deletes the run folder, or refuses with nothing deleted while the host still answers. It never
   deletes while the host answers.
2. **07, config applied log** (expected). Filtered self-tests `--plugin settings`, `--plugin forms`, `--plugin chat`
   pass: every step that waits for `[config] applied a new config` still sees it.
3. **04, fit check and split handles** (expected). Filtered self-tests `--plugin agent-skills`,
   `--plugin context-sources`, `--plugin agent-lines`, `--plugin live-view`, one at a time: none reports a fit problem
   on `ui-split-handle`.
4. **01, restored step header** (low-confidence: needs a restored transcript whose leading lines carry no timestamp;
   seed one per the drive skill's fixtures). After a drive `restart`, the first step header of that transcript shows
   its step text with no time.
5. **05, switch-off refusals** (expected). With a Docs tab holding unsaved edits, Settings refuses to switch off
   `docs-session-tab`. With the stash note dialog open, Settings refuses to switch off `session-stash`. With neither,
   both switch off.
6. **12, sessions header width** (low-confidence: no unit seam covers it, and L885 is fixed only "most likely" by
   later commits). Filtered self-test `--plugin agent-lines` with the side bar at its least width (160px): "Sessions"
   stays on one line, its prompts sit beside it or wrap under it, and the drive fit check passes, the session row
   (L885) included.
7. **13, input frame reset** (expected). Each framed text box (docs, settings, backlog, notes, sessions,
   session-stash, practice, and the rest 13 lists) shows no border, background or outline of its own, uses the frame's
   font and fills the frame's width. An unfocused docs tree keeps its inactive selection fill.
8. **14, Tag info tone** (expected). In a session's Docs tab, an on-demand chip draws in `status-info` over
   `status-info-tint`. The gallery (`Space z g`) Tag section shows "On demand" captioned Info.
9. **15, waveform primitive** (expected for the picker; low-confidence for the gallery screenshots, since the new
   section adds height and the forms self-test pages to the bottom on its own). The gallery shows a Waveform section
   after Sparkline, with Peaks, Silence and Loading samples. In the audio picker, candidate rows draw their waveform in
   `fg-tertiary` at the old size, turning accent on the cursor row.

## Dropped

Checks a group's own test already pins:

- 02, 06, 08, 09, 10, 16, 18: each GIVEN/WHEN/THEN has a unit test behind it in its task document.
- 11, a live click into the backlog review pane: pinned by 11's `focusin` test on the view.

Done when: every check above passes, or its failure is fixed in its group and the check re-run. Report each check
with its result, and attach the stills of checks 6–9.

## Proof
