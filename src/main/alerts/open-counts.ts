import type { AlertNoun } from '../../contracts/alerts';

export interface OpenCountPart {
  readonly count: number;
  readonly noun: AlertNoun;
}

// `parts` holds each source whose latest count is above 0, in the order each
// first set a count above 0, with its latest count and noun.
export interface OpenCounts {
  readonly total: number;
  readonly parts: readonly OpenCountPart[];
}

// Each source's latest open count; `set` records one and returns the sum over
// every source with the parts it is made of.
export function createOpenCounts(): {
  set(source: string, count: number, noun: AlertNoun): OpenCounts;
} {
  // A Map keeps a key's first insertion place: a source enters on its first
  // count above 0 and keeps that place when it falls to 0 and rises again.
  const latest = new Map<string, OpenCountPart>();
  return {
    set(source, count, noun) {
      const hasPlace = latest.has(source);
      if (hasPlace || count > 0) {
        latest.set(source, { count, noun });
      }
      let total = 0;
      const parts: OpenCountPart[] = [];
      for (const part of latest.values()) {
        total += part.count;
        if (part.count > 0) {
          parts.push(part);
        }
      }
      return { total, parts };
    },
  };
}

// The overlay text: each part as `<count> <singular|plural>`, joined with `, `;
// '' for no parts.
export function describeOpenCounts(parts: readonly OpenCountPart[]): string {
  return parts
    .map(({ count, noun }) => {
      const word = count === 1 ? noun.singular : noun.plural;
      return `${count} ${word}`;
    })
    .join(', ');
}
