import { describe, expect, it } from 'vitest';
import { createRegistrations } from './registrations';

function countedHandle() {
  const handle = {
    count: 0,
    dispose() {
      handle.count += 1;
    },
  };
  return handle;
}

describe('createRegistrations', () => {
  it('disposes every tracked handle once, newest first', () => {
    const regs = createRegistrations();
    const disposed: string[] = [];
    const named = (name: string) => ({
      dispose: () => {
        disposed.push(name);
      },
    });
    const a = named('a');

    expect(regs.track(a)).toBe(a);
    regs.track(named('b'));
    regs.track(named('c'));
    regs.dispose();
    regs.dispose();

    expect(disposed).toEqual(['c', 'b', 'a']);
  });

  it('disposes the rest when a handle throws, then throws the first error', () => {
    const regs = createRegistrations();
    const disposed: string[] = [];
    regs.track({
      dispose: () => {
        disposed.push('a');
      },
    });
    regs.track({
      dispose: () => {
        disposed.push('b');
        throw new Error('b failed');
      },
    });
    regs.track({
      dispose: () => {
        disposed.push('c');
        throw new Error('c failed');
      },
    });

    expect(() => regs.dispose()).toThrow('c failed');
    expect(disposed).toEqual(['c', 'b', 'a']);
  });

  it('disposes a handle tracked after dispose at once', () => {
    const regs = createRegistrations();
    const handle = countedHandle();
    regs.dispose();

    expect(regs.track(handle)).toBe(handle);
    expect(handle.count).toBe(1);
  });

  it('forgets a handle its owner disposed', () => {
    const regs = createRegistrations();
    const a = countedHandle();
    const b = countedHandle();
    regs.track(a);
    regs.track(b);

    a.dispose();
    expect(a.count).toBe(1);
    regs.dispose();

    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });
});
