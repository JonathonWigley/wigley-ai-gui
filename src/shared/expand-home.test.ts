import { describe, expect, it } from 'vitest';
import { expandHome } from './expand-home';

describe('expandHome', () => {
  it('expandHome_TildeSlash_JoinsHome', () => {
    expect(expandHome('~/.local/bin/claude', '/Users/u')).toBe(
      '/Users/u/.local/bin/claude',
    );
  });

  it('expandHome_OtherValues_ReturnedAsTheyStand', () => {
    for (const value of ['~', '/abs/x', 'rel/x', '~other/x']) {
      expect(expandHome(value, '/Users/u')).toBe(value);
    }
  });
});
