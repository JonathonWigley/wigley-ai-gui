# 01 — Window capture

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/window.ts`
Consumes:  `MainServices.window` (`show`, `isFocused`, `chooseFolder`) in `src/contracts/plugin.ts` (in the tree) ·
           `windowService(window: BrowserWindow): MainServices['window']` in `src/main/window.ts` (in the tree)
Produces:  in `src/contracts/plugin.ts`, `MainServices.window`:
           `capture(): Promise<Uint8Array>; // PNG of the window's content, as shown`
           in `src/main/window.ts`: `windowService` returns `capture`
Decisions: `capture` extends the existing `window` main service (plan.md Decisions) · the live window, the self-test
           window and the drive window all get the same Electron capture (see below) · no fake is added (see below)

## Where the change lands

- The window service is built in `src/main/window.ts` (`windowService`), not in `src/main/main.ts`. `main.ts` hands
  `windowService(window)` to the live services (`liveServices`) and spreads `...windowService(context.window)` in
  `offscreenRunServices` (self-test and drive). Both get `capture` from that one function. `main.ts` does not change.
- `capture` calls `window.webContents.capturePage()` with no rectangle, and resolves to `image.toPNG()`. A Node
  `Buffer` is a `Uint8Array`, so the result needs no copy.
- An empty image (`image.isEmpty()`) rejects with `Error('Window capture is empty')`. The caller then shows the
  failure; it never attaches an empty image.
- The capture is at the display's device pixels (a Retina window gives twice its CSS size). That is "as shown".
- `src/main/electron-driven-window.ts` keeps its own `capture(box)` for the drive and the self-test screenshots.
  Do not share code with it: its rectangle, its `stayHidden` option and its null-on-empty result serve the drive.
- Update the doc comment above `MainServices` in `src/contracts/plugin.ts` with one clause for `window.capture`:
  it resolves to a PNG of the window's content as the user sees it, and rejects when the capture is empty.

## Fakes

Every place that builds a `MainServices` value or its `window`, measured in this run:

| Place | What it builds | Change |
|---|---|---|
| `src/main/window.ts` `windowService` | the real `window` | gains `capture` (this task) |
| `src/main/main.ts` `liveServices` | `window: windowService(window)` | none |
| `src/main/main.ts` `offscreenRunServices` | `{ ...windowService(context.window), chooseFolder: async () => null }` | none: the spread carries `capture` |
| `src/main/plugins/main-api.test.ts` | `{ paths } as MainServices` and `as unknown as MainServices` casts | none: a cast needs no member |
| `src/plugins/chat/main/chat-sessions.ts` `ChatSessionsDeps.window` | its own `{ show(): void; isFocused(): boolean }` | none |
| `src/plugins/chat/main/chat-sessions.test.ts` | a `{ show, isFocused }` fake for that narrow type | none |

No other file builds a `MainServices` value. The notes main part (task 07) takes its own narrow capture dependency
and builds its own fake there.

GIVEN the live app WHEN a plugin calls `services.window.capture()` THEN it resolves to the PNG bytes of the window's
content.

Tests:     none. The change is one Electron call; no test can run it without Electron, and the compiler checks
           the member. The live capture is a check in task 11 (Final verification).
Done when: compiles; `npm run typecheck` and `npm run lint` pass.
Commit:    one commit for the group

## Proof

