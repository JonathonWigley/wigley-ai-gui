// What the frame's bootstrap measures on each change of the root's size or
// the frame's: the root's rounded-up height, `innerHeight`, and the root's
// `clientHeight`, which leaves out a horizontal scrollbar.
export interface HeightMeasurement {
  rootHeight: number;
  viewport: number;
  clientHeight: number;
}

// The height the frame last took and the root and viewport it is compared
// against.
export interface HeightBaseline {
  height: number;
  rootHeight: number;
  viewport: number;
}

export interface HeightDecision {
  baseline: HeightBaseline;
  height: number | null;
}

// Decides the height a measurement reports, `null` for none, and the baseline
// the next measurement compares against; `baseline` is `null` before the first
// report. The height is the root's plus the horizontal scrollbar's thickness.
// A measurement at the reported height moves the baseline to it. A root that
// grew by exactly what the viewport grew since the baseline follows the
// viewport (`min-height: 100vh`): it is dropped and keeps the baseline, since
// adding the bar again would grow the frame without end. The bootstrap script
// carries this function as its source text, so it reads nothing outside
// itself.
export function decideHeightReport(
  baseline: HeightBaseline | null,
  measured: HeightMeasurement,
): HeightDecision {
  const height =
    measured.rootHeight + measured.viewport - measured.clientHeight;
  const current = {
    height,
    rootHeight: measured.rootHeight,
    viewport: measured.viewport,
  };
  if (baseline === null) {
    return { baseline: current, height };
  }
  if (height === baseline.height) {
    return { baseline: current, height: null };
  }
  const viewportGrowth = measured.viewport - baseline.viewport;
  const rootGrowth = measured.rootHeight - baseline.rootHeight;
  const followsViewport = viewportGrowth !== 0 && rootGrowth === viewportGrowth;
  if (followsViewport) {
    return { baseline, height: null };
  }
  return { baseline: current, height };
}
