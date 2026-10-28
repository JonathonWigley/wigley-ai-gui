import { describe, expect, it } from 'vitest';
import type { ResizeDirection, ResizeTarget } from '../contracts/panes';
import { createPaneResize, type PaneResize } from './pane-resize';

// Each nudge the targets took, as `<target> <direction>`.
function recordingTargets() {
  const nudged: string[] = [];
  const target = (name: string): ResizeTarget => ({
    nudge: (direction: ResizeDirection) => nudged.push(`${name} ${direction}`),
  });
  return {
    nudged,
    sideBar: target('side bar'),
    split: target('split'),
    first: target('first'),
    second: target('second'),
  };
}

type Targets = ReturnType<typeof recordingTargets>;

describe('createPaneResize', () => {
  it.each([
    {
      steps: 'none',
      run: () => {},
      nudged: ['side bar right'],
    },
    {
      steps: 'setTarget(split)',
      run: (resize: PaneResize, targets: Targets) =>
        resize.setTarget(targets.split),
      nudged: ['split right'],
    },
    {
      steps: 'setTarget(split), setTarget(null)',
      run: (resize: PaneResize, targets: Targets) => {
        resize.setTarget(targets.split);
        resize.setTarget(null);
      },
      nudged: ['side bar right'],
    },
    {
      steps: 'setTarget(split), dropTarget()',
      run: (resize: PaneResize, targets: Targets) => {
        resize.setTarget(targets.split);
        resize.dropTarget();
      },
      nudged: ['side bar right'],
    },
    {
      steps: 'setTarget(first), setTarget(second)',
      run: (resize: PaneResize, targets: Targets) => {
        resize.setTarget(targets.first);
        resize.setTarget(targets.second);
      },
      nudged: ['second right'],
    },
  ])('nudges the target, else the side bar: $steps', ({ run, nudged }) => {
    const targets = recordingTargets();
    const resize = createPaneResize(targets.sideBar);

    run(resize, targets);
    resize.resize('right');

    expect(targets.nudged).toEqual(nudged);
  });
});
