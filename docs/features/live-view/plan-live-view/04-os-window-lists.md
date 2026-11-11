# 04 — macOS and Windows window lists

Status: in progress
Type: Batch
Rung: hard · two OS scripts whose output units and order the crop depends on; the Windows DPI conversion is a judgement
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`.

Files:
- create `src/main/screen-capture/mac-window-list.ts` · test `src/main/screen-capture/mac-window-list.test.ts`
- create `src/main/screen-capture/windows-window-list.ts` · test `src/main/screen-capture/windows-window-list.test.ts`
- modify `src/main/main.ts`: the `'macos'` and `'windows'` cases of `screenCaptureFor`
- modify `scripts/check-layers.mts`: entries for the two test files, if they import `src/shared` fakes

Consumes: `OsWindow`, `OsWindowLister`, `createScreenCapture`, `electronCaptureSources`, `macScreenAccess` and
`openMacScreenSettings` ← 01. Also the `ProcessRunner` that the system-stats adapters take.

Pattern to follow: `src/main/system-stats/mac-system-stats.ts` and `windows-system-stats.ts`. Each runs an OS command
through the `ProcessRunner`. Its parser is a pure function over the command's stdout, tested on captured output with
the shared fake processes.

Produces:
- `createMacWindowList(processes: ProcessRunner): OsWindowLister` and `parseMacWindowList(stdout: string): OsWindow[]` in `mac-window-list.ts`
- `createWindowsWindowList(processes: ProcessRunner): OsWindowLister` and `parseWindowsWindowList(stdout: string): OsWindow[]` in `windows-window-list.ts`

Decisions:
- **macOS:**
  - Run `osascript -l JavaScript -e <script>` through `requiredStdout`, with `RUN_TIMEOUT_MS = 10000`. A JXA cold
    start can pass the 5000 ms that the mac stats use. The script, verbatim (it ran on this Mac at plan time and
    listed every on-screen layer-0 window):

    ```js
    ObjC.import("CoreGraphics");
    const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
    JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0).map((w) => ({
      number: w.kCGWindowNumber, processId: w.kCGWindowOwnerPID, title: w.kCGWindowName ?? "",
      x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y,
      width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height })))
    ```

  - `kCGWindowName` is absent when Screen Recording is off, so `?? ""` keeps the row.
  - The list is already front to back, and the bounds are global points with a top-left origin. This is the space
    that Unity's rects use, so the adapter converts nothing.
  - The spike's script used `kCGWindowListOptionAll` and dropped untitled windows. The script above does neither,
    because the pick needs every on-screen window of the process, titled or not.
- **Windows:**
  - Run one PowerShell script through `requiredStdout` with `RUN_TIMEOUT_MS = 10000`. Use the program and the
    `-NoProfile -NonInteractive` flags of `windows-system-stats.ts`, but pass `-EncodedCommand <base64>` in place of
    `-Command <script>`. The base64 is of the script's UTF-16LE bytes (`Buffer.from(script, 'utf16le')`). Node wraps
    a `-Command` argument in double quotes on Windows, so a `-Command` script cannot hold `"`, and the `Add-Type` C#
    signatures need it (`[DllImport("user32.dll")]`). The parser test does not reach this. The user's Windows check
    (09) is its only proof.
  - The script `Add-Type`s user32 and dwmapi signatures. It walks `EnumWindows` (top-level windows come in z-order,
    front to back). It keeps windows that pass `IsWindowVisible`, are not minimized (`IsIconic`), and are not cloaked
    (`DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED = 14)` non-zero: another virtual desktop, a suspended app). It drops
    a window whose `DWMWA_EXTENDED_FRAME_BOUNDS` call fails or gives an empty rect.
  - For each window it reads `GetWindowThreadProcessId`, `GetWindowText`, `DwmGetWindowAttribute(hwnd,
    DWMWA_EXTENDED_FRAME_BOUNDS = 9)` and `GetDpiForWindow(hwnd)`. It prints JSON.
  - The parser divides each window's bounds by `dpi / 96` into points, because Unity reports `EditorWindow.position`
    in points. Unity's position on a mixed-DPI desktop is unverified. The user checks Windows live in the wrap-up.
  - `number` is the HWND printed as a decimal `[int64]`, because Electron's Windows source ids are `window:<hwnd>:0`
    with a decimal handle.
  - The parser keeps fractional points and does not round: at dpi 120, a 301-pixel edge is 240.8 points. macOS
    bounds can be fractional too, and the pick's 1-point slack takes up the difference.
  - The script sets the thread to per-monitor DPI aware (`SetThreadDpiAwarenessContext(-4)`) before it reads bounds,
    so DWM returns physical pixels.
- Both parsers drop a row that is missing a field. They throw with the command's text when the stdout is not a JSON
  array, as the system-stats parsers do. `requiredStdout` is in `src/main/processes/required-stdout.ts` (01 moves it there).
- `screenCaptureFor` cases:
  - `'macos'`: `createScreenCapture({ windows: createMacWindowList(runner), sources: electronCaptureSources, access: macScreenAccess, blockedWhenNoSources: true, openSettings: openMacScreenSettings })`
  - `'windows'`: `createScreenCapture({ windows: createWindowsWindowList(runner), sources: electronCaptureSources, access: () => 'granted', blockedWhenNoSources: false, openSettings: () => Promise.reject(new Error('Windows has no Screen Recording setting')) })`

GIVEN captured JXA output of three windows WHEN parsed THEN three OsWindows in the same order with their pids and bounds
GIVEN captured PowerShell output of a window at dpi 144 with frame bounds 300,150 to 1200,900 WHEN parsed THEN its bounds are `{ x: 200, y: 100, width: 600, height: 500 }`
GIVEN captured PowerShell output of a window at dpi 120 with frame bounds 301,150 to 1201,900 WHEN parsed THEN its bounds are `{ x: 240.8, y: 120, width: 720, height: 600 }`
GIVEN stdout that is not JSON WHEN parsed THEN it throws and names the command

Tests:
- One `it.each` table per parser, on captured output.
- Capture the macOS sample on this Mac with the script, then trim it to three windows.
- Write the Windows sample by hand to the script's output shape, with one row each at dpi 96, 120, 144 and 192.

Done when: `npm run typecheck` and `npm run lint` pass (lint runs the layer, composition-root and style checks). The test gate runs both parser tests. On this
Mac, a scratch run of `createMacWindowList` lists the open windows: this is the one live check this task can reach.
The Windows script runs only on Windows, so it waits for the user's Windows check (task 09).

Commit: one commit for the group.

## Proof
