// An item's texts to match, best tier first.
export type FuzzyTiers = readonly (readonly string[])[];

// Fuzzy text matching. A query is trimmed, then matched as one term: it has no
// search syntax, and a space inside it matches only a space in the text.
export interface FuzzyMatcher {
  // The items that match `query`, each once, best first: a match in an earlier
  // tier outranks any match in a later one, inside a tier an item takes its
  // best text's score, and the shorter text then input order break ties. An
  // empty query returns every item in input order.
  rank<T>(
    items: readonly T[],
    query: string,
    tiersOf: (item: T) => FuzzyTiers,
  ): T[];
  // Whether `query` matches `text`; an empty query matches every text.
  matches(query: string, text: string): boolean;
}
