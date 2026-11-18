import { describe, expect, it } from 'vitest';
import type { ChatCommandName } from '../ids';
import { controlCommand } from './control-commands';

describe('control commands', () => {
  it.each([
    { role: 'permissionMode', command: 'pickMode' },
    { role: 'effort', command: 'pickEffort' },
    { role: 'model', command: 'pickModel' },
    { role: 'sandbox', command: 'pickControl' },
    { role: null, command: 'pickControl' },
  ] satisfies { role: string | null; command: ChatCommandName }[])(
    'controlCommand_Role_ItsPickCommand ($role)',
    ({ role, command }) => {
      expect(controlCommand(role)).toBe(command);
    },
  );
});
