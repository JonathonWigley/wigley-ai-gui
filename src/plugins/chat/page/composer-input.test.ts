import { describe, expect, it } from 'vitest';
import type { ProcessActivity, SessionControl } from '../../../contracts/agent';
import type { SessionCompaction } from '../contract';
import { chipKeyCommands, composerInputOf } from './composer-input';

// A control with one choice, picked, whose label is `<label> value`; a null
// `role` leaves the control's role out.
function control(
  id: string,
  label: string,
  role: string | null,
): SessionControl {
  return {
    id,
    label,
    choices: [{ value: `${id}-value`, label: `${label} value` }],
    value: `${id}-value`,
    ...(role === null ? {} : { role }),
  };
}

const MODE = control('mode', 'Mode', 'permissionMode');
const EFFORT = control('effort', 'Effort', 'effort');
const MODEL = control('model', 'Model', 'model');
const VERBOSITY = control('verbosity', 'Verbosity', null);
const LLM = control('llm', 'Model', 'model');
const DEPTH = control('depth', 'Effort', 'effort');
const APP_COMPACTION: SessionCompaction = {
  trigger: 'app',
  reason: 'auto · cache cold · 182k',
  startedAt: 700,
};

// The control as its chip shows it while the process runs.
function chipOf(held: SessionControl) {
  return {
    id: held.id,
    label: held.label,
    value: `${held.label} value`,
    enabled: true,
    role: held.role ?? null,
  };
}

describe('composerInputOf', () => {
  it.each([
    {
      running: true,
      activity: 'idle',
      compaction: null,
      isBoxFocused: false,
      enabled: true,
      working: false,
    },
    {
      running: true,
      activity: 'working',
      compaction: null,
      isBoxFocused: false,
      enabled: true,
      working: true,
    },
    {
      running: true,
      activity: 'waiting',
      compaction: null,
      isBoxFocused: false,
      enabled: true,
      working: true,
    },
    {
      running: false,
      activity: 'working',
      compaction: null,
      isBoxFocused: true,
      enabled: false,
      working: false,
    },
    {
      running: true,
      activity: 'idle',
      compaction: APP_COMPACTION,
      isBoxFocused: false,
      enabled: true,
      working: true,
    },
    {
      running: false,
      activity: 'idle',
      compaction: APP_COMPACTION,
      isBoxFocused: false,
      enabled: false,
      working: false,
    },
  ] satisfies {
    running: boolean;
    activity: ProcessActivity;
    compaction: SessionCompaction | null;
    isBoxFocused: boolean;
    enabled: boolean;
    working: boolean;
  }[])(
    'composerInputOf_SessionStates_EnablesAndShowsWork (running $running, $activity, compaction $compaction.trigger, focused $isBoxFocused)',
    ({ running, activity, compaction, isBoxFocused, enabled, working }) => {
      const input = composerInputOf({
        name: 'tab',
        state: {
          running,
          activity,
          compaction,
          controls: [EFFORT],
          repo: 'clone',
          branch: 'main',
        },
        isBoxFocused,
      });

      expect(input).toEqual({
        session: 'tab',
        repo: 'clone',
        branch: 'main',
        isBoxFocused,
        running,
        working,
        modelEffort: null,
        controls: [
          {
            id: 'effort',
            label: 'Effort',
            value: 'Effort value',
            enabled,
            role: 'effort',
          },
        ],
      });
    },
  );

  it.each([
    {
      case: 'Mode, Effort, Model, Verbosity',
      controls: [MODE, EFFORT, MODEL, VERBOSITY],
      modelEffort: { model: chipOf(MODEL), effort: chipOf(EFFORT) },
      others: [chipOf(MODE), chipOf(VERBOSITY)],
    },
    {
      case: 'no Model',
      controls: [MODE, EFFORT, VERBOSITY],
      modelEffort: null,
      others: [chipOf(MODE), chipOf(EFFORT), chipOf(VERBOSITY)],
    },
    {
      case: 'Model with no Effort',
      controls: [MODEL, MODE],
      modelEffort: { model: chipOf(MODEL), effort: null },
      others: [chipOf(MODE)],
    },
    {
      case: 'roles on other ids',
      controls: [LLM, DEPTH, VERBOSITY],
      modelEffort: { model: chipOf(LLM), effort: chipOf(DEPTH) },
      others: [chipOf(VERBOSITY)],
    },
  ])(
    'composerInputOf_Controls_PairsModelAndEffort ($case)',
    ({ controls, modelEffort, others }) => {
      const input = composerInputOf({
        name: 'tab',
        state: {
          running: true,
          activity: 'idle',
          compaction: null,
          controls,
          repo: 'clone',
          branch: null,
        },
        isBoxFocused: false,
      });

      expect(input.modelEffort).toEqual(modelEffort);
      expect(input.controls).toEqual(others);
    },
  );
});

describe('chipKeyCommands', () => {
  it('chipKeyCommands_Controls_KeysOnFirstChipPerCommand', () => {
    const roles = ['permissionMode', 'sandbox', 'effort', null];

    expect(chipKeyCommands(roles.map((role) => ({ role })))).toEqual([
      'pickMode',
      'pickControl',
      'pickEffort',
      null,
    ]);
  });
});
