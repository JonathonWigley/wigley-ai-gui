import { describe, expect, it } from 'vitest';
import { roundErrorText } from '../../mcp-wording';
import { RoundError, type RoundItemPath } from '../../../contract';
import { BUILT_IN_KINDS } from '../formats';
import { noticeKind } from './notice-format';

const NOTICE_1: RoundItemPath = { at: 'item', kind: 'notice', number: 1 };

function notice(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Renamed the stale helper',
    context: '`_load_cfg` is now `_load_config`. No behaviour changed.',
    ...overrides,
  };
}

// The tool error text of the RoundError the notice format throws for this
// item.
function parseError(raw: unknown): string {
  try {
    noticeKind.parse(raw, NOTICE_1);
  } catch (error) {
    if (error instanceof RoundError) {
      return roundErrorText(BUILT_IN_KINDS, error);
    }
    throw error;
  }
  throw new Error('the notice format accepted the notice');
}

describe('noticeKind.parse', () => {
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
      noticeKind.parse(notice({ layout: 'compact' }), NOTICE_1).layout,
    ).toBe('compact');
    expect(noticeKind.parse(notice(), NOTICE_1).layout).toBeNull();
  });

  it('gives a notice the Applied badge by default', () => {
    expect(noticeKind.parse(notice(), NOTICE_1).badge).toBe('Applied');
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
