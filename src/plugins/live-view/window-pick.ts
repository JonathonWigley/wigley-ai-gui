import type {
  CaptureWindow,
  ScreenRect,
  WindowList,
} from '../../contracts/screen-capture';
import type { CaptureCrop, LivePick } from './contract';

// Points a Game View rect may stick out past each edge of the window that holds it.
const EDGE_SLACK = 1;

// How far the stream's aspect ratio may drift from the window's, as a fraction
// of the window's, before the window counts as resized.
const MOVED_RATIO_TOLERANCE = 0.02;

function holdsRect(bounds: ScreenRect, rect: ScreenRect): boolean {
  const holdsLeftAndTop =
    rect.x >= bounds.x - EDGE_SLACK && rect.y >= bounds.y - EDGE_SLACK;
  const holdsRightAndBottom =
    rect.x + rect.width <= bounds.x + bounds.width + EDGE_SLACK &&
    rect.y + rect.height <= bounds.y + bounds.height + EDGE_SLACK;
  return holdsLeftAndTop && holdsRightAndBottom;
}

function areaOf(bounds: ScreenRect): number {
  return bounds.width * bounds.height;
}

// The first of the largest windows, or null for none.
function largestWindow(
  windows: readonly CaptureWindow[],
): CaptureWindow | null {
  let largest: CaptureWindow | null = null;
  for (const window of windows) {
    if (largest === null || areaOf(window.bounds) > areaOf(largest.bounds)) {
      largest = window;
    }
  }
  return largest;
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function rectText(rect: ScreenRect): string {
  return `[${[rect.x, rect.y, rect.width, rect.height].join(', ')}]`;
}

// The editor process's window that streams, from windows listed front to
// back: with a Game View rect, the frontmost whose bounds hold it, so a
// floating Game View wins over the main window; with none, the largest, the
// first of equals. Null when none of the process's windows fits.
export function pickEditorWindow(
  windows: readonly CaptureWindow[],
  processId: number,
  gameRect: ScreenRect | null,
): CaptureWindow | null {
  const processWindows = windows.filter(
    (window) => window.processId === processId,
  );
  if (gameRect === null) {
    return largestWindow(processWindows);
  }
  return (
    processWindows.find((window) => holdsRect(window.bounds, gameRect)) ?? null
  );
}

// `rect` as fractions of `bounds`, clamped to the window, so the edge slack
// never crops past an edge.
export function cropOf(rect: ScreenRect, bounds: ScreenRect): CaptureCrop {
  const x = clampUnit((rect.x - bounds.x) / bounds.width);
  const y = clampUnit((rect.y - bounds.y) / bounds.height);
  return {
    x,
    y,
    width: Math.min(clampUnit(rect.width / bounds.width), 1 - x),
    height: Math.min(clampUnit(rect.height / bounds.height), 1 - y),
  };
}

// Whether the stream's shape left the window's shape at pick time by more
// than 2% of the window's aspect ratio: the editor was resized, so the crop
// no longer fits.
export function streamMoved(
  windowSize: { width: number; height: number },
  streamSize: { width: number; height: number },
): boolean {
  const windowRatio = windowSize.width / windowSize.height;
  const streamRatio = streamSize.width / streamSize.height;
  return (
    Math.abs(streamRatio - windowRatio) > windowRatio * MOVED_RATIO_TOLERANCE
  );
}

// The pick for the editor process `processId` of the project in `folder`, or
// the error text an agent reads when its windows have none to stream.
// Blocked access is a pick: the section shows that line.
export function pickOf(
  list: WindowList,
  processId: number,
  gameRect: ScreenRect | null,
  folder: string,
): { pick: LivePick } | { error: string } {
  if (list.access === 'blocked') {
    return { pick: { kind: 'blocked' } };
  }
  const window = pickEditorWindow(list.windows, processId, gameRect);
  if (window === null) {
    const hasProcessWindow = list.windows.some(
      (candidate) => candidate.processId === processId,
    );
    return !hasProcessWindow || gameRect === null
      ? {
          error: `${folder}'s editor (process ${processId}) has no window the app can stream; a minimized window cannot stream.`,
        }
      : {
          error: `The Game View rect ${rectText(gameRect)} is not inside any window of ${folder}'s editor. Call show_live_view again with the game_view of a fresh capture.py start, or with no gameRect to stream the whole editor.`,
        };
  }
  const { width, height } = window.bounds;
  return {
    pick: {
      kind: 'stream',
      sourceId: window.sourceId,
      summary:
        gameRect === null ? `Editor · ${folder}` : `Game View · ${folder}`,
      windowSize: { width, height },
      crop: gameRect === null ? null : cropOf(gameRect, window.bounds),
    },
  };
}

// `[x, y, width, height]` as a rect.
export function rectOfTuple(
  values: readonly [number, number, number, number],
): ScreenRect {
  const [x, y, width, height] = values;
  return { x, y, width, height };
}
