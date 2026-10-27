import { describe, expect, it } from 'vitest';
import { controlCommand } from './control-commands';

describe('control commands', () => {
  it('controlCommand_KeyedControl_ItsOwnPickCommand', () => {
    expect(controlCommand('effort')).toBe('pickEffort');
  });

  it('controlCommand_UnkeyedControl_ListsEveryControl', () => {
    expect(controlCommand('sandbox')).toBe('pickControl');
  });
});
