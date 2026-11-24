import { scanLines } from './sections';

export interface WikiShelf {
  title: string;
  items: WikiItem[];
}

export type WikiItem =
  | { type: 'label'; title: string }
  | { type: 'page'; title: string; target: WikiTarget };

export type WikiTarget =
  | { type: 'path'; path: string }
  | { type: 'skill'; prefix: string; name: string }
  | { type: 'kind'; kind: string }
  | { type: 'owner'; owner: 'third-party' }
  | { type: 'all' };

const SHELF_LEVEL = 2;
const LABEL_LEVEL = 3;

const WIKI_SCHEME = 'wiki:';
const KIND_TARGET = /^wiki:kind\/([^/]+)$/;

const LINK =
  /(?<![!\\])\[([^\]]+)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
const CODE_SPAN = /(`+).*?\1/g;

// Reads the file's headings and links into shelves: a level 2 heading is a
// shelf, a level 3 heading is a label in it, and each link on any other prose
// line under a shelf is a page. `linkPrefixes` are the binding's skill link
// prefixes (`parseWikiTarget`). Never throws.
export function parseWikiMain(
  text: string,
  linkPrefixes: Readonly<Record<string, string>>,
): WikiShelf[] {
  const shelves: WikiShelf[] = [];
  for (const line of scanLines(text)) {
    if (!line.isProse) {
      continue;
    }
    const shelf = shelves.at(-1);
    if (line.heading?.level === SHELF_LEVEL) {
      shelves.push({ title: line.heading.title, items: [] });
    } else if (line.heading?.level === LABEL_LEVEL) {
      shelf?.items.push({ type: 'label', title: line.heading.title });
    } else if (line.heading === null) {
      shelf?.items.push(...pagesOn(line.text, linkPrefixes));
    }
  }
  return shelves;
}

function pagesOn(
  line: string,
  linkPrefixes: Readonly<Record<string, string>>,
): WikiItem[] {
  const codeSpans = [...line.matchAll(CODE_SPAN)];
  const pages: WikiItem[] = [];
  for (const link of line.matchAll(LINK)) {
    const isInCodeSpan = codeSpans.some(
      (span) =>
        span.index <= link.index && link.index < span.index + span[0].length,
    );
    const target = isInCodeSpan
      ? null
      : parseWikiTarget(withoutAngleBrackets(link[2]), linkPrefixes);
    if (target !== null) {
      pages.push({ type: 'page', title: link[1], target });
    }
  }
  return pages;
}

function withoutAngleBrackets(target: string): string {
  return target.startsWith('<') ? target.slice(1, -1) : target;
}

// What a link's target text names: `<prefix><name>`, for a key of
// `linkPrefixes` (the longest that fits) and a name with no `/`, is a skill.
// Null is a `wiki:` link no page can act on, which adds no item.
export function parseWikiTarget(
  text: string,
  linkPrefixes: Readonly<Record<string, string>>,
): WikiTarget | null {
  if (text === 'wiki:all') {
    return { type: 'all' };
  }
  if (text === 'wiki:owner/third-party') {
    return { type: 'owner', owner: 'third-party' };
  }
  const kind = KIND_TARGET.exec(text);
  if (kind !== null) {
    return { type: 'kind', kind: kind[1] };
  }
  if (text.startsWith(WIKI_SCHEME)) {
    return null;
  }
  const prefix = Object.keys(linkPrefixes)
    .filter((each) => text.startsWith(each))
    .sort((a, b) => b.length - a.length)[0];
  const name = prefix === undefined ? '' : text.slice(prefix.length);
  if (prefix !== undefined && name !== '' && !name.includes('/')) {
    return { type: 'skill', prefix, name };
  }
  return { type: 'path', path: text };
}
