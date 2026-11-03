import { describe, expect, it } from 'vitest';
import { type HeightBaseline, decideHeightReport } from './visual-height';

// The bootstrap script carries the function as its source text, so the rows
// run that text: a read of module scope fails them.
const decideAsServed = new Function(
  `return ${decideHeightReport.toString()};`,
)() as typeof decideHeightReport;

// Each step is `[viewport, rootHeight, clientHeight]` as the frame measures
// it, and the height it reports, `null` for none. A step after a report
// measures the frame at that height. The scrollbar is 15 tall.
type Step = [[number, number, number], number | null];

describe('decideHeightReport', () => {
  it.each<{ trace: string; steps: Step[] }>([
    {
      trace: 'content-sized wide settles at content, margins and bar',
      steps: [
        [[0, 136, 0], 136],
        [[136, 136, 121], 151],
        [[151, 136, 136], null],
      ],
    },
    {
      trace: 'viewport-sized wide settles one bar over its content',
      steps: [
        [[0, 18, 0], 18],
        [[18, 18, 3], 33],
        [[33, 33, 18], null],
        [[33, 33, 18], null],
      ],
    },
    {
      trace: 'narrow growing in equal steps reports every step',
      steps: [
        [[0, 16, 0], 16],
        [[16, 16, 16], null],
        [[16, 36, 16], 36],
        [[36, 36, 36], null],
        [[36, 56, 36], 56],
        [[56, 56, 56], null],
        [[56, 76, 56], 76],
        [[76, 76, 76], null],
      ],
    },
    {
      trace: 'narrow that later scrolls sideways adds the bar',
      steps: [
        [[0, 100, 0], 100],
        [[100, 100, 100], null],
        [[100, 100, 85], 115],
        [[115, 100, 100], null],
      ],
    },
    {
      trace: 'narrow whose content doubles reports the new height',
      steps: [
        [[0, 100, 0], 100],
        [[100, 100, 100], null],
        [[100, 200, 100], 200],
        [[200, 200, 200], null],
      ],
    },
    {
      trace: 'viewport-sized wide growing after settling ends a bar taller',
      steps: [
        [[0, 300, 0], 300],
        [[300, 300, 285], 315],
        [[315, 315, 300], null],
        [[315, 400, 300], 415],
        [[415, 415, 400], 430],
        [[430, 430, 415], null],
      ],
    },
  ])('$trace', ({ steps }) => {
    let baseline: HeightBaseline | null = null;
    const reported: (number | null)[] = [];
    for (const [[viewport, rootHeight, clientHeight]] of steps) {
      const decision = decideAsServed(baseline, {
        rootHeight,
        viewport,
        clientHeight,
      });
      baseline = decision.baseline;
      reported.push(decision.height);
    }
    expect(reported).toEqual(steps.map(([, height]) => height));
  });
});
