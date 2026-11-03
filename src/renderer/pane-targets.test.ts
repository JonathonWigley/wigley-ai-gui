import { describe, expect, it } from 'vitest';
import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../contracts/panes';
import { createPaneTargets, type PaneTargets } from './pane-targets';

// Targets that answer `answer` and record each ask as `<target> <direction>`,
// with every log line the pane targets wrote.
function recordingTargets() {
  const asked: string[] = [];
  const logged: string[] = [];
  const resizer = (name: string, answer: boolean): ResizeTarget => ({
    nudge: (direction: PaneDirection) => {
      asked.push(`${name} ${direction}`);
      return answer;
    },
  });
  const mover = (name: string, answer: boolean): FocusTarget => ({
    move: (direction: PaneDirection) => {
      asked.push(`${name} ${direction}`);
      return answer;
    },
  });
  return { asked, logged, resizer, mover, log: (m: string) => logged.push(m) };
}

// `null` leaves the target unset.
type Answer = boolean | null;

describe('createPaneTargets', () => {
  it.each<{
    row: string;
    view: Answer;
    outer: Answer;
    sideBar: boolean;
    pushed?: boolean;
    direction: PaneDirection;
    asked: string[];
    logged: string[];
  }>([
    {
      row: 'view true',
      view: true,
      outer: true,
      sideBar: true,
      direction: 'right',
      asked: ['view right'],
      logged: [],
    },
    {
      row: 'view false, outer true',
      view: false,
      outer: true,
      sideBar: true,
      direction: 'up',
      asked: ['view up', 'outer up'],
      logged: [],
    },
    {
      row: 'view unset, outer false, side bar true',
      view: null,
      outer: false,
      sideBar: true,
      direction: 'left',
      asked: ['outer left', 'side bar left'],
      logged: [],
    },
    {
      row: 'view and outer unset, side bar true',
      view: null,
      outer: null,
      sideBar: true,
      direction: 'left',
      asked: ['side bar left'],
      logged: [],
    },
    {
      row: 'all false',
      view: false,
      outer: false,
      sideBar: false,
      direction: 'down',
      asked: ['view down', 'outer down', 'side bar down'],
      logged: ['no pane divider runs down'],
    },
    {
      row: 'scope pushed, view true',
      view: true,
      outer: true,
      sideBar: true,
      pushed: true,
      direction: 'right',
      asked: ['view right'],
      logged: [],
    },
  ])(
    'resizes through the first target that takes it: $row',
    ({ view, outer, sideBar, pushed = false, direction, asked, logged }) => {
      const fakes = recordingTargets();
      const targets = createPaneTargets(
        fakes.resizer('side bar', sideBar),
        () => pushed,
        fakes.log,
      );
      if (view !== null) {
        targets.setResizeTarget(fakes.resizer('view', view));
      }
      if (outer !== null) {
        targets.setOuterPanes({
          focus: fakes.mover('outer focus', true),
          resize: fakes.resizer('outer', outer),
        });
      }

      targets.resize(direction);

      expect(fakes.asked).toEqual(asked);
      expect(fakes.logged).toEqual(logged);
    },
  );

  it.each<{
    row: string;
    view: Answer;
    outer: Answer;
    pushed?: boolean;
    direction: PaneDirection;
    asked: string[];
    logged: string[];
  }>([
    {
      row: 'view true',
      view: true,
      outer: true,
      direction: 'left',
      asked: ['view left'],
      logged: [],
    },
    {
      row: 'view false, outer true',
      view: false,
      outer: true,
      direction: 'right',
      asked: ['view right', 'outer right'],
      logged: [],
    },
    {
      row: 'view unset, outer false',
      view: null,
      outer: false,
      direction: 'up',
      asked: ['outer up'],
      logged: ['no pane up'],
    },
    {
      row: 'view and outer unset',
      view: null,
      outer: null,
      direction: 'down',
      asked: [],
      logged: ['no pane down'],
    },
    {
      row: 'all false',
      view: false,
      outer: false,
      direction: 'down',
      asked: ['view down', 'outer down'],
      logged: ['no pane down'],
    },
    {
      row: 'scope pushed, view and outer true',
      view: true,
      outer: true,
      pushed: true,
      direction: 'right',
      asked: [],
      logged: ['no pane right while a scope is pushed'],
    },
  ])(
    'moves focus through the first target that takes it: $row',
    ({ view, outer, pushed = false, direction, asked, logged }) => {
      const fakes = recordingTargets();
      const targets = createPaneTargets(
        fakes.resizer('side bar', true),
        () => pushed,
        fakes.log,
      );
      if (view !== null) {
        targets.setFocusTarget(fakes.mover('view', view));
      }
      if (outer !== null) {
        targets.setOuterPanes({
          focus: fakes.mover('outer', outer),
          resize: fakes.resizer('outer resize', true),
        });
      }

      targets.focus(direction);

      expect(fakes.asked).toEqual(asked);
      expect(fakes.logged).toEqual(logged);
    },
  );

  it.each<{
    case: string;
    act(targets: PaneTargets, resize: ResizeTarget, outer: OuterPanes): void;
    asked: string[];
  }>([
    {
      case: 'the resize target',
      act(targets, resize) {
        targets.setResizeTarget(resize);
        targets.release(resize);
        targets.resize('left');
      },
      asked: ['side bar left'],
    },
    {
      case: 'the outer panes',
      act(targets, _resize, outer) {
        targets.setOuterPanes(outer);
        targets.release(outer);
        targets.focus('left');
      },
      asked: [],
    },
    {
      case: 'another object',
      act(targets, resize) {
        targets.setResizeTarget(resize);
        targets.release({ nudge: () => true });
        targets.resize('left');
      },
      asked: ['view left'],
    },
  ])(
    'release clears only the slots holding the target ($case)',
    ({ act, asked }) => {
      const fakes = recordingTargets();
      const targets = createPaneTargets(
        fakes.resizer('side bar', true),
        () => false,
        fakes.log,
      );

      act(targets, fakes.resizer('view', true), {
        focus: fakes.mover('outer focus', true),
        resize: fakes.resizer('outer resize', true),
      });

      expect(fakes.asked).toEqual(asked);
    },
  );

  it('drops the view targets and keeps the outer panes', () => {
    const fakes = recordingTargets();
    const targets = createPaneTargets(
      fakes.resizer('side bar', true),
      () => false,
      fakes.log,
    );
    targets.setResizeTarget(fakes.resizer('view resize', true));
    targets.setFocusTarget(fakes.mover('view focus', true));
    targets.setOuterPanes({
      focus: fakes.mover('outer focus', true),
      resize: fakes.resizer('outer resize', true),
    });

    targets.dropViewTargets();
    targets.focus('left');
    targets.resize('right');

    expect(fakes.asked).toEqual(['outer focus left', 'outer resize right']);
  });
});
