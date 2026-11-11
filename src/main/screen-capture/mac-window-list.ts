import type { ProcessRunner } from '../../contracts/processes';
import { requiredStdout } from '../processes/required-stdout';
import type { OsWindow, OsWindowLister } from './screen-capture';
import { parseWindowRows } from './window-rows';

// A JXA cold start can pass the 5000 ms the mac stats allow.
const RUN_TIMEOUT_MS = 10000;

const OSASCRIPT = '/usr/bin/osascript';

// Every on-screen layer-0 window, titled or not, front to back, with global
// bounds in points from a top-left origin. `kCGWindowName` is absent while
// Screen Recording is off, so `?? ""` keeps the row.
export const MAC_WINDOW_LIST_SCRIPT = [
  'ObjC.import("CoreGraphics");',
  'const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));',
  'JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0).map((w) => ({',
  '  number: w.kCGWindowNumber, processId: w.kCGWindowOwnerPID, title: w.kCGWindowName ?? "",',
  '  x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y,',
  '  width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height })))',
].join('\n');

const OSASCRIPT_ARGS = ['-l', 'JavaScript', '-e', MAC_WINDOW_LIST_SCRIPT];

const NUMBER_KEYS = [
  'number',
  'processId',
  'x',
  'y',
  'width',
  'height',
] as const;

// The macOS OsWindowLister: one `osascript` run of `MAC_WINDOW_LIST_SCRIPT`
// through `processes`. A run that cannot run, times out, exits non-zero or
// prints no JSON array rejects naming `osascript`.
export function createMacWindowList(processes: ProcessRunner): OsWindowLister {
  return {
    async list(): Promise<readonly OsWindow[]> {
      const stdout = await requiredStdout(
        processes,
        OSASCRIPT,
        OSASCRIPT_ARGS,
        { timeoutMs: RUN_TIMEOUT_MS },
      );
      return parseMacWindowList(stdout);
    },
  };
}

// The windows of `MAC_WINDOW_LIST_SCRIPT`'s stdout, in its order, bounds as
// printed; a row missing a field is dropped. Throws naming `osascript` when
// the stdout is not a JSON array.
export function parseMacWindowList(stdout: string): OsWindow[] {
  return parseWindowRows(stdout, 'osascript', NUMBER_KEYS).map((row) => ({
    number: row.number,
    processId: row.processId,
    title: row.title,
    bounds: { x: row.x, y: row.y, width: row.width, height: row.height },
  }));
}
