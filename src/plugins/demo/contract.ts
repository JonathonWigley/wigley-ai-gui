// The demo plugin's shared names: the run's state on screen, the step agent's
// id, and the channel the page drives the run's main side through.

import type { ChannelShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';

// The demo's own step: a real Claude session on the default profile.
export const REAL_SESSION_STEP_ID = 'demo.realSession';

// The step agent's agent id with scoped-agents; its scope is the step id.
export const STEP_AGENT_ID = 'step';

// The run as the page shows it: `stepId` null before the first step, `beat`
// counting from 0, `realShown` whether the user's real sessions show beside
// the Demo section.
export interface DemoRunState {
  running: boolean;
  stepId: string | null;
  beat: number;
  autoplay: boolean;
  realShown: boolean;
}

export const demoRunSlot: SlotKey<DemoRunState, 'page', 'demo'> = {
  id: 'demo.run',
  process: 'page',
  kind: 'value',
};

// What the page tells main of a step, for its step agent's instructions and
// title: `files` repo-relative, `beats` the beat names in order.
export interface DemoStepBrief {
  id: string;
  plugin: string;
  title: string;
  caption: string;
  files: readonly string[];
  beats: readonly string[];
}

// Every method rejects with main's own error text when its handler throws.
export interface DemoChannel extends ChannelShape {
  invoke: {
    // Stops a live run first, empties the scratch folder, registers the demo
    // harness and runs the plugins the user switched off, in memory.
    start(): Promise<{ scratchDir: string }>;
    // Enters the step's main half, leaving a held one first; resolves to its
    // sessions by key, {} for a step with no main half. Rejects
    // `The demo is not running.` with no live run.
    enterStep(stepId: string): Promise<Readonly<Record<string, string>>>;
    // Leaves the held main half when its id is `stepId` and closes its
    // sessions; does nothing for any other id.
    leaveStep(stepId: string): Promise<void>;
    // Keeps the step's brief for its step agent, across runs.
    describeStep(brief: DemoStepBrief): void;
    // Leaves the held step, closes every demo session, and gives back the
    // plugin switch and the demo harness; does nothing with no live run.
    stop(): Promise<void>;
    // The page's report at each stop; settles a waiting self-test result and
    // is dropped when none waits.
    report(report: DemoRunReport): void;
  };
  messages: {
    // A self-test opened run `selfTestOpened`.
    selfTestOpened: number;
  };
}

// What a run left uncovered: `missing` the built-in plugins with no page step
// and no `demoSkip`, in catalog order; `failed` the step ids whose enter, beat
// or leave failed, once each in first-failure order.
export interface DemoRunReport {
  missing: string[];
  failed: string[];
}
