import { describe, expect, it } from 'vitest';
import type { CommandRow } from './keymap-rows';
import { matchesCommand } from './row-filter';

describe('matchesCommand', () => {
  it('matchesCommand_ByKeys', () => {
    const row: CommandRow = {
      command: {
        id: 'core.showSessions',
        plugin: 'core',
        label: 'Show sessions',
        group: 'g',
        runsIn: 'page',
      },
      binds: [
        {
          bind: {
            keys: '<Leader>ks',
            scope: 'any',
            command: 'core.showSessions',
          },
          origin: 'default',
          state: 'active',
          replacedBy: null,
        },
      ],
      accelerators: [],
    };

    expect(matchesCommand(row, 'ks')).toBe(true);
  });
});
