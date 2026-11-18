import { DEMO_SECTIONS, type DemoStep } from '../../../contracts/demo';
import type {
  CaptionInput,
  StepListInput,
  StepRowInput,
} from '../layouts/layout';
import { type RunDriverState, runOrder } from './run-driver';

// The step list the panel draws: each section that holds a step, in
// `DEMO_SECTIONS` order with its title, its steps in run order. `beats` are the
// held stage's beat names, listed only under the current step.
export function stepListInput(
  steps: readonly DemoStep[],
  state: RunDriverState,
  beats: readonly string[],
  cursorId: string | null,
  autoplay: boolean,
  realShown: boolean,
): StepListInput {
  const ordered = runOrder(steps);
  const rowOf = (step: DemoStep): StepRowInput => {
    const isCurrent = step.id === state.stepId;
    return {
      id: step.id,
      title: step.title,
      isCurrent,
      isCursor: step.id === cursorId,
      beats: isCurrent
        ? beats.map((name, index) => ({
            name,
            isCurrent: index === state.beat,
          }))
        : [],
    };
  };
  const sections = DEMO_SECTIONS.map(({ id, title }) => ({
    title,
    steps: ordered.filter(({ section }) => section === id).map(rowOf),
  })).filter((section) => section.steps.length > 0);
  return { sections, autoplay, realShown };
}

// The caption for the held step; null with none held, or when its step is no
// longer registered.
export function captionInput(
  steps: readonly DemoStep[],
  state: RunDriverState,
): CaptionInput | null {
  const ordered = runOrder(steps);
  const index = ordered.findIndex(({ id }) => id === state.stepId);
  if (index === -1) {
    return null;
  }
  const step = ordered[index];
  return {
    title: step.title,
    caption: step.caption,
    stepNumber: index + 1,
    stepCount: ordered.length,
    autoplay: state.autoplay,
  };
}

// The cursor one step down or up in run order, stopping at the ends; a cursor
// on no step lands on the first. Null with no step.
export function movedCursor(
  steps: readonly DemoStep[],
  cursorId: string | null,
  move: 'down' | 'up',
): string | null {
  const ids = runOrder(steps).map(({ id }) => id);
  const index = cursorId === null ? -1 : ids.indexOf(cursorId);
  if (index === -1) {
    return ids.at(0) ?? null;
  }
  const moved = move === 'down' ? index + 1 : index - 1;
  return ids[Math.min(Math.max(moved, 0), ids.length - 1)];
}
