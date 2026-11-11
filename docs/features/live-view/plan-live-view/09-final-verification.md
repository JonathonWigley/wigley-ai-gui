# 09 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 08
Plan: [plan.md](plan.md)

`wigley:make` walks this once, in its live session after the test gate. Risk tier: Medium. The change adds a core
service with OS adapters, a chat layout option and a new plugin, and none of them touches saved data.

## Checks

1. **Expected path — the section fits.** Read the self-test screenshot from 06 (`live-view-live-section.png`). It
   shows Live directly under Main agent, the portrait sample whole, and no scrollbar in the hub.
   - Why: video fit and `shrinksLast` are layout that no unit test can see.
2. **Low-confidence path — `shrinksLast` with a crowded hub.** Read 06's `live-view-crowded-hub.png` (chat's preview,
   so Live, Skills and Context all show). Live keeps its frame, and Skills and Context each keep their head and a few
   lines.
   - Why: the flex order is CSS with no test (02).
   - A self-test step cannot set the window height. When the self-test window is tall enough that nothing gives up
     height, say so in Proof: the user's macOS check below covers it.
3. **Expected path — the probe rect.** 07's two PNGs (docked and floating) show no toolbar strip. When 07 ran after
   the last change to `WigleyCapture.cs`, read its Proof and do not run it again.
4. **Low-confidence path — the macOS window list on a real editor.** Claim a pool clone as 07 does, and open its
   editor in Play Mode. A throwaway vitest file in the gui worktree (deleted before any commit; `node` and `npx` are
   denied here, so run it through `npm test -- <file>`):
   - runs `createMacWindowList` over the real process runner (`src/main/processes/node-processes.ts`)
   - reads the pid from the clone's `Library/EditorInstance.json`
   - calls `pickEditorWindow` with the `game_view` of a fresh `capture.py start`

   It passes when the picked window's `processId` is that pid and its title holds the clone's folder name. Release
   the clone after.
   - Why: the pid and the bounds come from two OS sources that only a live editor joins.

Dropped: the window pick, crop, moved and blocked rules (`window-pick.test.ts`, `main/start.test.ts`), and the
stream's start and stop on visibility (`live-section.test.ts`). Each is pinned by a test.

## For the user (wrap-up only)

Only the user's eyes can settle these, in the app running this build with a real editor:

- **macOS:**
  - Run a `wigley:unity-playtest` session. Live appears under Main agent with the Game View alone, with no toolbar
    strip, and fits the hub.
  - Collapse Live, then reopen it. The macOS screen-recording indicator goes off, then on.
  - Resize the editor window. The moved line shows with the whole editor.
  - Make the app window about 700 px high with Plan, Skills and Context showing. Live keeps its frame; the others
    keep their head and a few lines.
  - Close the editor. The closed line shows.
  - `hide_live_view` hides the section.
- **macOS Screen Recording off:**
  - Turn Auri off in System Settings › Privacy & Security › Screen Recording, then call `show_live_view`. The line
    and the `Open System Settings` button show.
  - The button opens that pane.
- **Windows:** the same playtest on the Windows machine, at a display scale above 100%. The crop lands on the Game
  View.
