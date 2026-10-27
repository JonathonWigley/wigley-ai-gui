import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import type { VimMode } from '../../../contracts/editor';
import { chipKeyCommands, composerInputOf } from './composer-input';

const INSERT: VimMode = { mode: 'insert', subMode: '' };
const controls = [
  {
    id: 'effort',
    label: 'Effort',
    choices: [{ value: 'high', label: 'High' }],
    value: 'high',
  },
];

describe('composerInputOf', () => {
  it.each([
    {
      running: true,
      activity: 'idle',
      isBoxFocused: false,
      enabled: true,
      working: false,
      modeLabel: 'PAGE',
    },
    {
      running: true,
      activity: 'working',
      isBoxFocused: false,
      enabled: true,
      working: true,
      modeLabel: 'PAGE',
    },
    {
      running: true,
      activity: 'waiting',
      isBoxFocused: false,
      enabled: true,
      working: true,
      modeLabel: 'PAGE',
    },
    {
      running: false,
      activity: 'working',
      isBoxFocused: true,
      enabled: false,
      working: false,
      modeLabel: 'INSERT',
    },
  ] satisfies {
    running: boolean;
    activity: ProcessActivity;
    isBoxFocused: boolean;
    enabled: boolean;
    working: boolean;
    modeLabel: string;
  }[])(
    'composerInputOf_SessionStates_EnablesAndShowsWork (running $running, $activity, focused $isBoxFocused)',
    ({ running, activity, isBoxFocused, enabled, working, modeLabel }) => {
      const input = composerInputOf({
        name: 'repo',
        state: { running, activity, controls },
        isBoxFocused,
        boxMode: INSERT,
      });

      expect(input).toEqual({
        session: 'repo',
        modeLabel,
        isBoxFocused,
        running,
        working,
        controls: [{ id: 'effort', label: 'Effort', value: 'High', enabled }],
      });
    },
  );
});

describe('chipKeyCommands', () => {
  it('chipKeyCommands_Controls_KeysOnFirstChipPerCommand', () => {
    const ids = ['mode', 'sandbox', 'effort', 'verbosity'];

    expect(chipKeyCommands(ids.map((id) => ({ id })))).toEqual([
      'pickMode',
      'pickControl',
      'pickEffort',
      null,
    ]);
  });
});
