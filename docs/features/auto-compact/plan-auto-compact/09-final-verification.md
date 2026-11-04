# 09 — Final verification

Status: done
Type: Task
Wave: 7 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none (scratch output under the session scratchpad)
Consumes:  the drive actions `chat.holdCompactions` and `chat.releaseCompactions` ← 05; the fake's `FAKE_COLD_TEXT`
           and `FAKE_COMPACT_TEXT` ← 03; the default layouts ← 04, 06; the auto-compact plugin ← 07
Decisions: every check runs through `npm run drive` (`.agents/skills/drive/SKILL.md`), offscreen, with frames or a
           video captured across each moment named below. A check is settled by what the frames show.

Before the drive: run `npm run typecheck`, `npm run lint` and `npm test` on the whole tree once, since the waves
broke typecheck between tasks 02 and 06. Then run `npm run selftest -- --plugin chat` and
`npm run selftest -- --plugin usage` (the groups tasks 04, 05 and 06 added). Do not run the whole self-test.

## Checks

Each check is tagged **expected** (the change doing what it was made to do) or **low-confidence** (where a bug is
likely), with its reason.

1. **Expected — app hold, end to end.** With the auto-compact plugin on at its default setting: `chat.holdCompactions`,
   send `fake: cold`, wait for the log `<name> is idle`, then send `next message`. The held row reads `sends after compaction · ⌃C skips`. The dock reads
   `0:0x Compacting… auto · cache cold · 200k` over the bar, with no tool card. The usage line opens with
   `compacting · auto` and its meter pulses. Then `chat.releaseCompactions`: the row is written, the dock follows the
   new turn, and the transcript shows `Compacted 200k → 24k · auto · <time>` (first `Compacted 200k · auto · <time>`
   until the next reply's usage). Reason: the whole flow crosses four tasks; only a live run shows them together.
2. **Expected — manual trigger.** In a fresh session (its latest main usage small), send `/compact` with compactions held: the dock reads `Compacting… /compact`, the
   chip reads `compacting`, and the divider after release reads `… · manual · …`.
3. **Expected — harness trigger.** In a fresh session, send `fake: compact` with compactions held: the dock reads `Compacting… autocompact`
   with no tool card, the chip reads `compacting · autocompact`, and the divider reads `… · autocompact · …`.
4. **Expected — ⌃C skips.** Repeat check 1 up to the held row, then press `⌃C`: the compaction ends, the held row is
   written, and a second row queued behind it is written after it, in order. Repeat with `⌘↩` on the held row.
5. **Expected — layout preview.** The chat layout preview shows the divider sample.
6. **Expected — the interrupt hint.** During check 1's hold, the status line shows the running interrupt keys while
   the session's activity reads idle.
7. **Low-confidence — the release moment.** Capture frames across `chat.releaseCompactions` in check 1. The dock must
   reach the new turn's live line within 500 ms, with no done line or hidden dock left standing. Reason: the `compaction`,
   `entry` and `activity` messages arrive in an order the page does not control (task 06).
8. **Low-confidence — narrow tab bar.** Turn the `usage-tab-line` plugin on, narrow the pane, and run check 3: the
   line drops whole items from its end and keeps the context bar beside `compacting · autocompact`. Reason: the chip
   is drawn first, so a long chip can push the context bar out (task 04).
9. **Low-confidence — real Claude interrupt.** In a drive run on the real Claude harness, a small session: send
   `/compact`, press `⌃C` within 2 s. The dock clears and a divider or an interrupted end follows within 5 s, and the
   next sent message runs. Reason: interrupting `/compact` was unmeasured until task 01; the adapter's grace path is
   new (task 02).
10. **Low-confidence — reduced motion.** Emulate `prefers-reduced-motion: reduce` in the drive's window if the drive
    can (Electron's `webContents` emulation or a CSS media override). The dock's bar and the chip's meter are static.
    When the drive cannot emulate it, list it as the user's check in the wrap-up, with steps: macOS System Settings ›
    Accessibility › Display › Reduce motion on, then run check 1 in the dev app.

Done when: every check above has its frames or its result recorded in Proof, each failure is fixed or reported, and
any check left to the user is listed in the run's wrap-up with its steps.
Commit:    none, unless a fix lands; a fix is its own commit naming the check it fixes

## Proof

Commit 64bf958e · proof: Drive runs ac91, ac92, fix8, frames under /tmp/claude-autocompact/drive. PASS 1, 2, 3, 4, 5, 7, 8 (after the chip fix), 9 on real Claude at about 0.3 s, grace path not exercised. 6 as written is unreachable: a hold's activity reads working on both harnesses, so idle never occurs; the hints were seen during the hold. 10 goes to the user: the drive has no media emulation. · concerns: At the 420 px minimum window the chip reads c with a clipped ellipsis; composer's bottom row spills under a full composer at 720x600, pre-existing max-height 50% with nothing scrolling, the chip adds one row
