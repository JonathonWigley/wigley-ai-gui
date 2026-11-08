import { describe, expect, it } from 'vitest';
import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../contracts/panes';
import {
  createPaneTargets,
  type PaneAreas,
  type PaneTargets,
  type RightBarStop,
} from './pane-targets';

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

// Areas with no side bar stop and no right-bar stops.
const NO_AREAS: PaneAreas = {
  focusSideBar: () => false,
  focusMain: () => undefined,
  rightBarStops: () => [],
};

// A `defer` that runs at once, for tests no deferred work reaches.
const runNow = (run: () => void) => run();

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
        NO_AREAS,
        runNow,
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
        NO_AREAS,
        runNow,
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
        NO_AREAS,
        runNow,
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
      NO_AREAS,
      runNow,
    );
    targets.setResizeTarget(fakes.resizer('view resize', true));
    targets.setFocusTarget(fakes.mover('view focus', true));
    targets.setOuterPanes({
      focus: fakes.mover('outer focus', true),
      resize: fakes.resizer('outer resize', true),
    });

    targets.baseChanged();
    targets.focus('left');
    targets.resize('right');

    expect(fakes.asked).toEqual(['outer focus left', 'outer resize right']);
  });

  // Pane targets whose view and outer panes answer false, over fake areas
  // that record each ask into the same `asked`: `side bar`, `main`, and
  // `stop <n>` for the nth right-bar stop, plus `left <n>` when `hasLeft`.
  // `focusSideBar` answers `sideBar`, after the targets' own `baseChanged`
  // when `sideBarSetsScope`, as a mode's own `setScope` runs it.
  function areaTargets(options: {
    sideBar?: boolean;
    stops?: number;
    hasLeft?: boolean;
    sideBarSetsScope?: boolean;
  }) {
    const fakes = recordingTargets();
    let isPushed = false;
    const stops: RightBarStop[] = Array.from(
      { length: options.stops ?? 0 },
      (_, index) => ({
        focus: () => fakes.asked.push(`stop ${index + 1}`),
        left: options.hasLeft
          ? () => fakes.asked.push(`left ${index + 1}`)
          : undefined,
      }),
    );
    let liveStops = stops;
    const deferred: (() => void)[] = [];
    const targets: PaneTargets = createPaneTargets(
      fakes.resizer('side bar resize', true),
      () => isPushed,
      fakes.log,
      {
        focusSideBar() {
          fakes.asked.push('side bar');
          if (options.sideBarSetsScope) {
            targets.baseChanged();
          }
          return options.sideBar ?? false;
        },
        focusMain: () => fakes.asked.push('main'),
        rightBarStops: () => liveStops,
      },
      (run) => deferred.push(run),
    );
    targets.setFocusTarget(fakes.mover('view', false));
    targets.setOuterPanes({
      focus: fakes.mover('outer', false),
      resize: fakes.resizer('outer resize', false),
    });
    return {
      ...fakes,
      targets,
      stops,
      push: () => {
        isPushed = true;
      },
      pop: () => {
        isPushed = false;
      },
      remove(stop: RightBarStop) {
        liveStops = liveStops.filter((live) => live !== stop);
        targets.stopRemoved(stop);
      },
      flush() {
        for (const run of deferred.splice(0)) {
          run();
        }
      },
      clear() {
        fakes.asked.length = 0;
        fakes.logged.length = 0;
      },
    };
  }

  type AreaFakes = ReturnType<typeof areaTargets>;

  it.each<{
    row: string;
    sideBar?: boolean;
    stops?: number;
    sideBarSetsScope?: boolean;
    before?: PaneDirection[];
    between?(fakes: AreaFakes): void;
    direction: PaneDirection;
    asked: string[];
    logged: string[];
  }>([
    {
      row: 'main, left, side bar true',
      sideBar: true,
      direction: 'left',
      asked: ['view left', 'outer left', 'side bar'],
      logged: ['focus in the side bar'],
    },
    {
      row: 'main, left, side bar false',
      sideBar: false,
      direction: 'left',
      asked: ['view left', 'outer left', 'side bar'],
      logged: ['no pane left'],
    },
    {
      row: 'main, right, 2 stops',
      stops: 2,
      direction: 'right',
      asked: ['view right', 'outer right', 'stop 1'],
      logged: ['focus in the right bar'],
    },
    {
      row: 'main, right, 0 stops',
      direction: 'right',
      asked: ['view right', 'outer right'],
      logged: ['no pane right'],
    },
    {
      row: 'main, up, 2 stops',
      stops: 2,
      direction: 'up',
      asked: ['view up', 'outer up'],
      logged: ['no pane up'],
    },
    {
      row: 'side, right',
      sideBar: true,
      before: ['left'],
      direction: 'right',
      asked: ['main'],
      logged: ['focus back in main'],
    },
    {
      row: 'side, left',
      sideBar: true,
      before: ['left'],
      direction: 'left',
      asked: [],
      logged: ['no pane left'],
    },
    {
      row: 'side, down',
      sideBar: true,
      before: ['left'],
      direction: 'down',
      asked: [],
      logged: ['no pane down'],
    },
    {
      row: 'right on stop 1 of 2, down',
      stops: 2,
      before: ['right'],
      direction: 'down',
      asked: ['stop 2'],
      logged: ['focus in the right bar'],
    },
    {
      row: 'right on stop 2 of 2, down',
      stops: 2,
      before: ['right', 'down'],
      direction: 'down',
      asked: [],
      logged: ['no pane down'],
    },
    {
      row: 'right on stop 2 of 2, up',
      stops: 2,
      before: ['right', 'down'],
      direction: 'up',
      asked: ['stop 1'],
      logged: ['focus in the right bar'],
    },
    {
      row: 'right, left',
      stops: 2,
      before: ['right'],
      direction: 'left',
      asked: ['main'],
      logged: ['focus back in main'],
    },
    {
      row: 'right, right',
      stops: 2,
      before: ['right'],
      direction: 'right',
      asked: [],
      logged: ['no pane right'],
    },
    {
      row: 'side, scope pushed',
      sideBar: true,
      before: ['left'],
      between: (fakes) => fakes.push(),
      direction: 'right',
      asked: [],
      logged: ['no pane right while a scope is pushed'],
    },
    {
      row: 'side, then baseChanged, left',
      sideBar: true,
      before: ['left'],
      between: (fakes) => fakes.targets.baseChanged(),
      direction: 'left',
      asked: ['outer left', 'side bar'],
      logged: ['focus in the side bar'],
    },
    {
      row: 'side, entered by a focusSideBar that sets its own scope, right',
      sideBar: true,
      sideBarSetsScope: true,
      before: ['left'],
      direction: 'right',
      asked: ['main'],
      logged: ['focus back in main'],
    },
    {
      row: 'side bar opened over main, right',
      between: (fakes) => fakes.targets.sideBarOpened(),
      direction: 'right',
      asked: ['main'],
      logged: ['focus in the side bar', 'focus back in main'],
    },
  ])(
    "reaches the areas past main's edge: $row",
    ({ before = [], between, direction, asked, logged, ...options }) => {
      const fakes = areaTargets(options);
      for (const press of before) {
        fakes.targets.focus(press);
      }
      fakes.clear();
      between?.(fakes);

      fakes.targets.focus(direction);

      expect(fakes.asked).toEqual(asked);
      expect(fakes.logged).toEqual(logged);
    },
  );

  it.each<{
    case: string;
    act(fakes: AreaFakes): void;
    asked: string[];
    logged: string[];
  }>([
    {
      case: 'the holding stop removed',
      act(fakes) {
        fakes.targets.focus('right');
        fakes.clear();
        fakes.remove(fakes.stops[0]);
        fakes.targets.focus('left');
      },
      asked: ['left 1', 'main', 'view left', 'outer left', 'side bar'],
      logged: ['focus back in main', 'focus in the side bar'],
    },
    {
      case: 'another stop removed',
      act(fakes) {
        fakes.targets.focus('right');
        fakes.clear();
        fakes.remove(fakes.stops[2]);
        fakes.targets.focus('down');
      },
      asked: ['left 1', 'stop 2'],
      logged: ['focus in the right bar'],
    },
    {
      // Breaks when a removal under a pushed scope runs focusMain at once,
      // whose base change closes the overlay, or never gives main the keys.
      case: 'the holding stop removed under a pushed scope',
      act(fakes) {
        fakes.targets.focus('right');
        fakes.clear();
        fakes.push();
        fakes.remove(fakes.stops[0]);
        fakes.targets.pushedScopesClosed();
        fakes.asked.push('popped');
        fakes.pop();
        fakes.targets.pushedScopesClosed();
        fakes.targets.pushedScopesClosed();
      },
      asked: ['left 1', 'popped', 'main'],
      logged: ['focus back in main'],
    },
    {
      // Breaks when a base change under the overlay leaves main owed the keys.
      case: 'the holding stop removed under a pushed scope, then a base change',
      act(fakes) {
        fakes.targets.focus('right');
        fakes.clear();
        fakes.push();
        fakes.remove(fakes.stops[0]);
        fakes.targets.baseChanged();
        fakes.pop();
        fakes.targets.pushedScopesClosed();
      },
      asked: ['left 1'],
      logged: [],
    },
    {
      case: 'removed while the side area holds',
      act(fakes) {
        fakes.targets.focus('left');
        fakes.clear();
        fakes.remove(fakes.stops[0]);
      },
      asked: [],
      logged: [],
    },
  ])(
    "stopRemoved ends only the holding stop's turn: $case",
    ({ act, asked, logged }) => {
      const fakes = areaTargets({ sideBar: true, stops: 3, hasLeft: true });

      act(fakes);

      expect(fakes.asked).toEqual(asked);
      expect(fakes.logged).toEqual(logged);
    },
  );

  it.each<{
    case: string;
    act(fakes: AreaFakes): void;
    asked: string[];
    logged: string[];
  }>([
    {
      // Breaks when the stop's scope stays in force once no view set its own.
      case: 'focus landed on an element whose view sets no scope',
      act: (fakes) => fakes.targets.focusLeftRightBar(),
      asked: ['left 1', 'main'],
      logged: ['focus back in main'],
    },
    {
      // Breaks when focusMain overrides the scope the clicked view set.
      case: 'focus landed on an element whose view sets its scope',
      act(fakes) {
        fakes.targets.focusLeftRightBar();
        fakes.targets.baseChanged();
      },
      asked: ['left 1'],
      logged: ['focus back in main'],
    },
    {
      // Breaks when the deferred focusMain changes the base under an overlay.
      case: 'focus landed outside, then a scope is pushed',
      act(fakes) {
        fakes.targets.focusLeftRightBar();
        fakes.push();
      },
      asked: ['left 1'],
      logged: ['focus back in main'],
    },
    {
      case: 'focus dropped from the right bar to no element',
      act: (fakes) => fakes.targets.focusDroppedFromRightBar(),
      asked: ['left 1', 'main'],
      logged: ['focus back in main'],
    },
    {
      case: 'a base change, then focus left the right bar',
      act(fakes) {
        fakes.targets.baseChanged();
        fakes.targets.focusLeftRightBar();
        fakes.targets.focusDroppedFromRightBar();
      },
      asked: ['left 1'],
      logged: [],
    },
    {
      // Breaks when an overlay taking the focus over a stop runs focusMain,
      // whose base change closes the overlay.
      case: 'focus left the right bar under a pushed scope',
      act(fakes) {
        fakes.push();
        fakes.targets.focusLeftRightBar();
        fakes.targets.focusDroppedFromRightBar();
      },
      asked: [],
      logged: [],
    },
    {
      case: 'Alt+j to the next stop',
      act: (fakes) => fakes.targets.focus('down'),
      asked: ['left 1', 'stop 2'],
      logged: ['focus in the right bar'],
    },
    {
      case: 'Alt+h back to main',
      act: (fakes) => fakes.targets.focus('left'),
      asked: ['left 1', 'main'],
      logged: ['focus back in main'],
    },
  ])(
    "ends a right-bar stop's turn with its left, but not under a pushed scope: $case",
    ({ act, asked, logged }) => {
      const fakes = areaTargets({ stops: 2, hasLeft: true });
      fakes.targets.focus('right');
      fakes.clear();

      act(fakes);
      fakes.flush();
      fakes.flush();

      expect(fakes.asked).toEqual(asked);
      expect(fakes.logged).toEqual(logged);
    },
  );

  it('ignores focus leaving the right bar while main or the side bar holds the keys', () => {
    const fakes = areaTargets({ sideBar: true, stops: 2, hasLeft: true });

    fakes.targets.focusLeftRightBar();
    fakes.targets.focusDroppedFromRightBar();
    fakes.targets.focus('left');
    fakes.targets.focusLeftRightBar();
    fakes.targets.focusDroppedFromRightBar();

    expect(fakes.asked).toEqual(['view left', 'outer left', 'side bar']);
  });
});
