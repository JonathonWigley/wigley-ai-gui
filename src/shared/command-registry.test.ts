import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './command-registry';

describe('CommandRegistry', () => {
  it("register's handle unregisters the command", () => {
    const commands = new CommandRegistry<object>();
    const handle = commands.register('p.go', () => {});

    handle.dispose();
    handle.dispose();

    expect(commands.has('p.go')).toBe(false);
    expect(() => commands.run('p.go', {})).toThrow(
      'No command is registered as "p.go"',
    );
  });

  it('a disposed handle leaves the command registered after it', () => {
    const commands = new CommandRegistry<object>();
    const ran: string[] = [];
    const first = commands.register('p.go', () => ran.push('first'));
    first.dispose();
    commands.register('p.go', () => ran.push('second'));

    first.dispose();
    commands.run('p.go', {});

    expect(ran).toEqual(['second']);
  });
});
