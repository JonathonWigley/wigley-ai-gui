import { Fzf } from 'fzf';
import type { FuzzyMatcher, FuzzyTiers } from '../../contracts/fuzzy';

const MATCH_OPTIONS = {
  fuzzy: 'v2',
  casing: 'case-insensitive',
  normalize: true,
} as const;

interface ItemText {
  itemIndex: number;
  text: string;
}

// The texts in tier `tier` of every item not yet placed, in input order.
function textsInTier(
  tiersByItem: readonly FuzzyTiers[],
  tier: number,
  placed: ReadonlySet<number>,
): ItemText[] {
  const texts: ItemText[] = [];
  tiersByItem.forEach((tiers, itemIndex) => {
    if (placed.has(itemIndex)) {
      return;
    }
    for (const text of tiers[tier] ?? []) {
      texts.push({ itemIndex, text });
    }
  });
  return texts;
}

export function createFzfMatcher(): FuzzyMatcher {
  return {
    rank(items, query, tiersOf) {
      const term = query.trim();
      if (term === '') {
        return [...items];
      }
      const tiersByItem = items.map(tiersOf);
      const tierCount = Math.max(
        0,
        ...tiersByItem.map((tiers) => tiers.length),
      );
      const placed = new Set<number>();
      const ranked: (typeof items)[number][] = [];
      for (let tier = 0; tier < tierCount; tier++) {
        const finder = new Fzf(textsInTier(tiersByItem, tier, placed), {
          ...MATCH_OPTIONS,
          selector: (itemText) => itemText.text,
        });
        // fzf returns best score first, list order inside one score.
        for (const { item } of finder.find(term)) {
          if (!placed.has(item.itemIndex)) {
            placed.add(item.itemIndex);
            ranked.push(items[item.itemIndex]);
          }
        }
      }
      return ranked;
    },
    matches(query, text) {
      return new Fzf([text], MATCH_OPTIONS).find(query.trim()).length > 0;
    },
  };
}
