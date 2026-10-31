import { describe, expect, it } from 'vitest';
import { createEntryStamp } from './entry-stamp';

describe('createEntryStamp', () => {
  it('stamp_SameIdKeepsFirstAt_NewIdTakesNow', () => {
    let now = 1000;
    const stamp = createEntryStamp({ now: () => now });
    const draft = (id: string, text: string) => ({
      kind: 'assistant' as const,
      id,
      text,
      streaming: false,
      raw: [],
    });

    const first = stamp(draft('t1', 'a'));
    now = 5000;
    const again = stamp(draft('t1', 'ab'));
    const fresh = stamp(draft('t2', 'c'));

    expect(first).toMatchObject({ id: 't1', at: 1000 });
    expect(again).toMatchObject({ id: 't1', text: 'ab', at: 1000 });
    expect(fresh).toMatchObject({ id: 't2', at: 5000 });
  });
});
