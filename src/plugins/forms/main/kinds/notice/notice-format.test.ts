import { describe, expect, it } from 'vitest';
import { RoundError } from '../../round-error';
import { noticeFormat } from './notice-format';

function notice(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Renamed the stale helper',
    context: '`_load_cfg` is now `_load_config`. No behaviour changed.',
    ...overrides,
  };
}

// The message of the RoundError the notice format throws for this item.
function parseError(raw: unknown): string {
  try {
    noticeFormat.parse(raw, 'Notice 1: ');
  } catch (error) {
    if (error instanceof RoundError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('the notice format accepted the notice');
}

describe('noticeFormat.parse', () => {
  it('names a missing notice field and the two required names', () => {
    const partial: Record<string, unknown> = notice();
    delete partial.context;

    const message = parseError(partial);

    expect(message).toMatch(/^Notice 1: .*\bcontext\b/);
    expect(message).toContain('title, context');
  });

  it('refuses choices on a notice as an unknown field', () => {
    expect(parseError(notice({ choices: ['a', 'b'] }))).toMatch(
      /^Notice 1: .*\bchoices\b/,
    );
  });

  it('refuses a notice that is not an object', () => {
    expect(parseError('not an object')).toMatch(/^Notice 1: .*object/);
  });

  it('accepts an optional layout', () => {
    expect(
      noticeFormat.parse(notice({ layout: 'compact' }), 'Notice 1: ').layout,
    ).toBe('compact');
    expect(noticeFormat.parse(notice(), 'Notice 1: ').layout).toBeNull();
  });

  it('gives a notice the Applied badge by default', () => {
    expect(noticeFormat.parse(notice(), 'Notice 1: ').badge).toBe('Applied');
  });

  it('refuses a badge outside the closed set, naming the set and the value', () => {
    const message = parseError(notice({ badge: 'In progress' }));

    expect(message).toContain('badge');
    for (const badge of ['Applied', 'Dispatched', 'Decided']) {
      expect(message).toContain(badge);
    }
    expect(message).toContain("'In progress'");
  });
});
