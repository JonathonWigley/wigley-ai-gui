import type { FuzzyMatcher } from '../contracts/fuzzy';

function isSubsequence(query: string, text: string): boolean {
  const lowered = text.toLowerCase();
  let from = 0;
  for (const char of query.trim().toLowerCase()) {
    from = lowered.indexOf(char, from) + 1;
    if (from === 0) {
      return false;
    }
  }
  return true;
}

// A matcher with no fzf behind it: a query matches a text holding its
// characters in order, ignoring case; `rank` orders by tier, then input order.
export const fakeFuzzyMatcher: FuzzyMatcher = {
  rank(items, query, tiersOf) {
    const firstTier = (item: (typeof items)[number]) =>
      tiersOf(item).findIndex((texts) =>
        texts.some((text) => isSubsequence(query, text)),
      );
    return items
      .map((item) => ({ item, tier: firstTier(item) }))
      .filter(({ tier }) => tier !== -1)
      .sort((a, b) => a.tier - b.tier)
      .map(({ item }) => item);
  },
  matches: isSubsequence,
};
