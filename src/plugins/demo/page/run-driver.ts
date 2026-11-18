import type { Timers } from '../../../contracts/ambient';
import {
  DEMO_SECTIONS,
  type DemoStage,
  type DemoStep,
} from '../../../contracts/demo';
import { errorText } from '../../../shared/error-text';
import { createSerialQueue } from '../../../shared/serial-queue';
import { REAL_SESSION_STEP_ID } from '../contract';

// `beat` counts from 0; `beatCount` is the held stage's, 0 with none held.
export interface RunDriverState {
  stepId: string | null;
  beat: number;
  beatCount: number;
  autoplay: boolean;
}

// `enter` sets a step up and `leave` removes it; `failed` hears a step whose
// enter, beat or leave failed. `autoplaySeconds` is the setting, read at each
// beat the autoplay timer is armed for.
export interface RunDriverDeps {
  steps(): readonly DemoStep[];
  enter(step: DemoStep): Promise<DemoStage>;
  leave(step: DemoStep, stage: DemoStage): Promise<void>;
  timers: Timers;
  autoplaySeconds(): number;
  changed(state: RunDriverState): void;
  failed(stepId: string, error: unknown): void;
  log(line: string): void;
}

// Walks the steps in run order, beat by beat, every call run after the one
// before it settles, autoplay's moves included. `start` enters the first step;
// `next` and `previous` move a beat, then a step at a step's ends; `goTo`
// enters a step at beat 0, rejecting `No demo step <id>.` for an id no step
// holds; `reset` enters the held step again; `stop` turns autoplay off and
// leaves the held step. With no step held, `next`, `previous` and `reset`
// enter the first step, as `start` does. A step whose enter fails holds a
// one-beat `failed` stage, so the run goes on. Autoplay shows each beat for
// the longer of the setting (at least 1 s) and the beat's own dwell, then
// moves on; it stops on the last beat before the real-session step, and on
// the last beat of the last step.
export interface RunDriver {
  start(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  goTo(stepId: string): Promise<void>;
  reset(): Promise<void>;
  setAutoplay(on: boolean): void;
  stop(): Promise<void>;
  state(): RunDriverState;
  current(): { step: DemoStep; stage: DemoStage } | null;
}

// The step that sorts first: by its section's place in `DEMO_SECTIONS`, then
// `order`, then `id`.
function compareSteps(a: DemoStep, b: DemoStep): number {
  const bySection = sectionIndex(a) - sectionIndex(b);
  if (bySection !== 0) {
    return bySection;
  }
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

function sectionIndex(step: DemoStep): number {
  return DEMO_SECTIONS.findIndex(({ id }) => id === step.section);
}

export function runOrder(steps: readonly DemoStep[]): DemoStep[] {
  return [...steps].sort(compareSteps);
}

interface Held {
  step: DemoStep;
  stage: DemoStage;
  beat: number;
}

// Which beat of an entered stage a move shows.
type BeatOf = (stage: DemoStage) => number;

const firstBeat: BeatOf = () => 0;
const lastBeat: BeatOf = (stage) => stage.beats.length - 1;

// The stage a step whose enter failed holds: one beat that shows nothing, and
// the dispose of the beatless stage its enter returned, when it returned one.
function failedStage(dispose: () => void): DemoStage {
  return { beats: [{ name: 'failed', show() {} }], dispose };
}

export function createRunDriver(deps: RunDriverDeps): RunDriver {
  const { log } = deps;
  const queue = createSerialQueue();
  let held: Held | null = null;
  let autoplay = false;
  let timer: number | null = null;
  // Grows at each arm and disarm, so a fire queued behind a move made since
  // moves nothing.
  let armCount = 0;

  const state = (): RunDriverState => ({
    stepId: held?.step.id ?? null,
    beat: held?.beat ?? 0,
    beatCount: held?.stage.beats.length ?? 0,
    autoplay,
  });

  // The steps sorting just after or just before `step`, by its sort key, so a
  // step whose plugin stopped still has neighbours.
  const stepAfter = (step: DemoStep): DemoStep | undefined =>
    runOrder(deps.steps()).find((each) => compareSteps(each, step) > 0);
  const stepBefore = (step: DemoStep): DemoStep | undefined =>
    runOrder(deps.steps()).findLast((each) => compareSteps(each, step) < 0);

  const disarm = () => {
    armCount += 1;
    if (timer !== null) {
      deps.timers.clear(timer);
      timer = null;
    }
  };

  const arm = () => {
    disarm();
    if (!autoplay || held === null) {
      return;
    }
    const beat = held.stage.beats[held.beat];
    const seconds = Math.max(
      Math.max(1, deps.autoplaySeconds()),
      beat.dwellSeconds ?? 0,
    );
    const armedAt = armCount;
    timer = deps.timers.set(() => {
      timer = null;
      queue
        .run(() => autoplayFired(armedAt))
        .catch((error: unknown) =>
          log(`autoplay move failed: ${errorText(error)}`),
        );
    }, seconds * 1000);
  };

  const setAutoplayOn = (on: boolean) => {
    if (on === autoplay) {
      return;
    }
    autoplay = on;
    log(on ? 'autoplay on' : 'autoplay off');
    if (on) {
      arm();
    } else {
      disarm();
    }
    deps.changed(state());
  };

  const showBeat = async (target: Held, beat: number) => {
    target.beat = beat;
    const shown = target.stage.beats[beat];
    try {
      await shown.show();
    } catch (error) {
      deps.failed(target.step.id, error);
    }
    deps.changed(state());
    log(
      `showing ${target.step.id} beat ${beat + 1} of ${target.stage.beats.length}: ${shown.name}`,
    );
    arm();
  };

  const enterStep = async (step: DemoStep, beatOf: BeatOf) => {
    let stage: DemoStage;
    try {
      stage = await deps.enter(step);
    } catch (error) {
      deps.failed(step.id, error);
      stage = failedStage(() => undefined);
    }
    if (stage.beats.length === 0) {
      deps.failed(step.id, new Error(`Step ${step.id} has no beats.`));
      const beatless = stage;
      stage = failedStage(() => beatless.dispose());
    }
    const target: Held = { step, stage, beat: 0 };
    held = target;
    await showBeat(target, beatOf(stage));
  };

  const leaveHeld = async () => {
    if (held === null) {
      return;
    }
    const { step, stage } = held;
    held = null;
    disarm();
    try {
      await deps.leave(step, stage);
    } catch (error) {
      deps.failed(step.id, error);
    }
  };

  const enterFirst = async () => {
    const first = runOrder(deps.steps()).at(0);
    if (first === undefined) {
      log('no steps');
      return;
    }
    await leaveHeld();
    await enterStep(first, firstBeat);
  };

  const moveNext = async () => {
    if (held === null) {
      await enterFirst();
      return;
    }
    if (held.beat < held.stage.beats.length - 1) {
      await showBeat(held, held.beat + 1);
      log('moved next');
      return;
    }
    const next = stepAfter(held.step);
    if (next === undefined) {
      log('at the last beat');
      return;
    }
    await leaveHeld();
    await enterStep(next, firstBeat);
    log('moved next');
  };

  const movePrevious = async () => {
    if (held === null) {
      await enterFirst();
      return;
    }
    if (held.beat > 0) {
      await showBeat(held, held.beat - 1);
      log('moved previous');
      return;
    }
    const previous = stepBefore(held.step);
    if (previous === undefined) {
      log('at the first beat');
      return;
    }
    await leaveHeld();
    await enterStep(previous, lastBeat);
    log('moved previous');
  };

  // A fire armed before the last arm or disarm is stale: a move since re-armed
  // or autoplay turned off.
  const autoplayFired = async (armedAt: number) => {
    if (armedAt !== armCount || !autoplay || held === null) {
      return;
    }
    const isLastBeat = held.beat === held.stage.beats.length - 1;
    const next = isLastBeat ? stepAfter(held.step) : undefined;
    if (isLastBeat && next?.id === REAL_SESSION_STEP_ID) {
      log(`autoplay stopped before ${REAL_SESSION_STEP_ID}`);
      setAutoplayOn(false);
      return;
    }
    if (isLastBeat && next === undefined) {
      log('autoplay stopped at the end');
      setAutoplayOn(false);
      return;
    }
    await moveNext();
  };

  return {
    start: () => queue.run(enterFirst),
    next: () => queue.run(moveNext),
    previous: () => queue.run(movePrevious),
    goTo: (stepId) =>
      queue.run(async () => {
        const step = deps.steps().find(({ id }) => id === stepId);
        if (step === undefined) {
          throw new Error(`No demo step ${stepId}.`);
        }
        await leaveHeld();
        await enterStep(step, firstBeat);
        log(`went to ${stepId}`);
      }),
    reset: () =>
      queue.run(async () => {
        if (held === null) {
          await enterFirst();
          return;
        }
        const { step } = held;
        await leaveHeld();
        await enterStep(step, firstBeat);
        log(`reset ${step.id}`);
      }),
    setAutoplay: setAutoplayOn,
    stop: () =>
      queue.run(async () => {
        setAutoplayOn(false);
        await leaveHeld();
      }),
    state,
    current: () =>
      held === null ? null : { step: held.step, stage: held.stage },
  };
}
