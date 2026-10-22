import { describe, expect, it } from 'vitest';
import { controlCommand } from './control-commands';

describe('control commands', () => {
  it('controlCommand_KeyedControls', () => {
    expect(controlCommand('mode')).toBe('pickMode');
    expect(controlCommand('effort')).toBe('pickEffort');
    expect(controlCommand('model')).toBe('pickModel');
  });

  it('controlCommand_UnkeyedControl_ListsEveryControl', () => {
    expect(controlCommand('sandbox')).toBe('pickControl');
  });
});
