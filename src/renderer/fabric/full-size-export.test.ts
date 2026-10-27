import { describe, expect, it } from 'vitest';
import { fullSizeExport } from './full-size-export';

// The output canvas size Fabric 7's `toCanvasElement` makes: each side times
// the multiplier, truncated by the canvas element.
function outputSize(area: ReturnType<typeof fullSizeExport>) {
  return {
    width: Math.trunc(area.width * area.multiplier),
    height: Math.trunc(area.height * area.multiplier),
  };
}

describe('fullSizeExport', () => {
  it('fullSizeExport_ImageShownScaledDown_RendersAtImageSize', () => {
    // 2880×1800 shown in a 450-wide host: 281.25 high on screen.
    const area = fullSizeExport({ width: 2880, height: 1800 }, 450 / 2880);

    expect(outputSize(area)).toEqual({ width: 2880, height: 1800 });
  });

  it('fullSizeExport_ZoomWithNoExactInverse_RendersAtImageSize', () => {
    const area = fullSizeExport({ width: 1001, height: 777 }, 1 / 3);

    expect(outputSize(area)).toEqual({ width: 1001, height: 777 });
  });

  it('fullSizeExport_ImageShownAtOwnSize_RendersAtImageSize', () => {
    const area = fullSizeExport({ width: 640, height: 480 }, 1);

    expect(area.multiplier).toBe(1);
    expect(outputSize(area)).toEqual({ width: 640, height: 480 });
  });
});
