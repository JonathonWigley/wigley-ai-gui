import { describe, expect, it, vi } from 'vitest';
import { commandRunner } from './kit-commands';

// Commands where only `known` is registered.
function commandsKnowing(known: string) {
  return { exists: (id: string) => id === known, run: vi.fn() };
}

describe('commandRunner', () => {
  it('commandRunner_UnknownId_Throws', () => {
    const commands = commandsKnowing('demo.run');

    expect(() => commandRunner('docs.noSuch', commands)).toThrow(
      'no command docs.noSuch',
    );
    expect(commands.run).not.toHaveBeenCalled();
  });

  it('commandRunner_KnownId_RunsOnEachCall', () => {
    const commands = commandsKnowing('demo.run');

    const runner = commandRunner('demo.run', commands);
    expect(commands.run).not.toHaveBeenCalled();
    runner();
    runner();

    expect(commands.run.mock.calls).toEqual([['demo.run'], ['demo.run']]);
  });
});
