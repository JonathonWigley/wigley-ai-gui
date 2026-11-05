import { element } from '../../../shared/page/dom';
import type { IndexLink } from '../contract';

// A character's place in a block's text runs.
export interface RunPoint {
  run: number;
  offset: number;
}

// `end` is exclusive and always in the run holding the match's last character.
// `nextIndex` is the joined index after the match, where the next search of the
// same runs starts.
export interface RawMatch {
  start: RunPoint;
  end: RunPoint;
  nextIndex: number;
}

const SOURCE_LINE_SELECTOR = '[data-source-line]';
// What shows as written, or holds a link already: no match reads its text.
const UNWALKED_SELECTOR = 'pre, .md-fence, .md-image, a';

const WHITESPACE = /\s/;

// A reference's source text as it reads once rendered: its marks gone, and a
// wrapped reference's line break and lead one space.
export function matchText(raw: string): string {
  return raw
    .replace(/[`*]/g, '')
    .replace(/\n[ \t>]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// `runs` joined with every `*` left out and each whitespace run one space,
// with the run point each joined character came from.
function joinRuns(runs: readonly string[]): {
  text: string;
  points: RunPoint[];
} {
  let text = '';
  const points: RunPoint[] = [];
  runs.forEach((run, runIndex) => {
    for (let offset = 0; offset < run.length; offset++) {
      const isSpace = WHITESPACE.test(run[offset]);
      const isDropped = run[offset] === '*' || (isSpace && text.endsWith(' '));
      if (!isDropped) {
        text += isSpace ? ' ' : run[offset];
        points.push({ run: runIndex, offset });
      }
    }
  });
  return { text, points };
}

// The first match of `raw` at or after the joined index `fromIndex`, exactly;
// null when there is none.
export function findRaw(
  runs: readonly string[],
  raw: string,
  fromIndex: number,
): RawMatch | null {
  const { text, points } = joinRuns(runs);
  const wanted = matchText(raw);
  const index = text.indexOf(wanted, fromIndex);
  if (index === -1) {
    return null;
  }
  const nextIndex = index + wanted.length;
  const last = points[nextIndex - 1];
  return {
    start: points[index],
    end: { run: last.run, offset: last.offset + 1 },
    nextIndex,
  };
}

// The section links of each block, by the block's index in `blockLines`: the
// last block in document order at or before the link's line. A link in the
// frontmatter or above the first block is left out.
export function linksByBlock(
  links: readonly IndexLink[],
  blockLines: readonly number[],
  bodyStartLine: number,
): Map<number, IndexLink[]> {
  const byBlock = new Map<number, IndexLink[]>();
  for (const link of links) {
    const bodyLine = link.line - bodyStartLine + 1;
    const block = blockLines.findLastIndex((line) => line <= bodyLine);
    if (link.form === 'section' && bodyLine >= 1 && block !== -1) {
      byBlock.set(block, [...(byBlock.get(block) ?? []), link]);
    }
  }
  return byBlock;
}

// The block's own text nodes in order: none inside an element that is its own
// block, shows as written or is a link.
function textNodesOf(block: HTMLElement): Text[] {
  if (block.matches(UNWALKED_SELECTOR)) {
    return [];
  }
  const walker = document.createTreeWalker(
    block,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        const inner = node as Element;
        const isUnwalked =
          inner.hasAttribute('data-source-line') ||
          inner.matches(UNWALKED_SELECTOR);
        return isUnwalked ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    },
  );
  const nodes: Text[] = [];
  while (walker.nextNode() !== null) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

// `edge`, or the highest element over it inside `block` that it begins or ends,
// as `edgeChild` reads, and that does not hold `other`.
function liftEdge(
  edge: ChildNode,
  other: Node,
  block: HTMLElement,
  edgeChild: (parent: ParentNode) => ChildNode | null,
): ChildNode {
  let lifted = edge;
  for (;;) {
    const parent = lifted.parentElement;
    const canLift =
      parent !== null &&
      parent !== block &&
      edgeChild(parent) === lifted &&
      !parent.contains(other);
    if (!canLift) {
      return lifted;
    }
    lifted = parent;
  }
}

// Splits the match's text out of `nodes` as whole text nodes, its first and its
// last; null when its points no longer fit the block. An offset at a node's edge
// splits nothing, since that would leave an empty node.
function splitMatch(
  nodes: readonly Text[],
  { start, end }: RawMatch,
  block: HTMLElement,
): { first: Text; last: Text } | null {
  const startNode = nodes.at(start.run);
  const endNode = nodes.at(end.run);
  const fits =
    startNode !== undefined &&
    endNode !== undefined &&
    block.contains(startNode) &&
    block.contains(endNode) &&
    start.offset < startNode.length &&
    end.offset <= endNode.length;
  if (!fits) {
    return null;
  }
  if (end.offset < endNode.length) {
    endNode.splitText(end.offset);
  }
  const first =
    start.offset === 0 ? startNode : startNode.splitText(start.offset);
  return { first, last: startNode === endNode ? first : endNode };
}

// Wraps the match in `anchor`. A match that begins or ends inside an inline
// element it does not enclose stays text.
function wrapMatch(
  nodes: readonly Text[],
  match: RawMatch,
  block: HTMLElement,
  anchor: HTMLElement,
): void {
  const split = splitMatch(nodes, match, block);
  if (split === null) {
    return;
  }
  const first = liftEdge(
    split.first,
    split.last,
    block,
    (parent) => parent.firstChild,
  );
  const last = liftEdge(split.last, first, block, (parent) => parent.lastChild);
  const parent = first.parentNode;
  if (parent === null || parent !== last.parentNode) {
    first.parentNode?.normalize();
    last.parentNode?.normalize();
    return;
  }
  parent.insertBefore(anchor, first);
  let moving: ChildNode = first;
  while (moving !== last) {
    const next = moving.nextSibling as ChildNode;
    anchor.append(moving);
    moving = next;
  }
  anchor.append(last);
}

// A link as the renderer builds one, so the body's click listener and Tab reach
// it, holding where it leads.
function linkAnchor(link: IndexLink, title: string): HTMLElement {
  const anchor = element('a', 'md-link');
  anchor.setAttribute('href', '#');
  anchor.title = title;
  anchor.dataset.docPath = link.target;
  if (link.targetLine !== null) {
    anchor.dataset.docLine = String(link.targetLine);
  }
  return anchor;
}

// Finds every link in the block's runs first, then wraps last-match-first, so
// the earlier matches' points stay valid: a wrap only splits the nodes at or
// after its own start, and a split keeps the text before it in the same node.
function linkBlock(
  block: HTMLElement,
  links: readonly IndexLink[],
  titleOf: (link: IndexLink) => string,
): void {
  const nodes = textNodesOf(block);
  const runs = nodes.map((node) => node.data);
  const matches: { link: IndexLink; match: RawMatch }[] = [];
  let fromIndex = 0;
  for (const link of links) {
    const match = findRaw(runs, link.raw, fromIndex);
    if (match !== null) {
      matches.push({ link, match });
      fromIndex = match.nextIndex;
    }
  }
  for (const { link, match } of matches.reverse()) {
    wrapMatch(nodes, match, block, linkAnchor(link, titleOf(link)));
  }
}

// Turns each section link's text in the rendered `body` into a link. A link
// with no block, no match or a match the wrap cannot enclose stays text, with no
// toast and no log: no link is a guess.
export function linkSections(
  body: HTMLElement,
  links: readonly IndexLink[],
  bodyStartLine: number,
  titleOf: (link: IndexLink) => string,
): void {
  const blocks = [...body.querySelectorAll<HTMLElement>(SOURCE_LINE_SELECTOR)];
  const blockLines = blocks.map((block) => Number(block.dataset.sourceLine));
  const byBlock = linksByBlock(links, blockLines, bodyStartLine);
  for (const [index, blockLinks] of byBlock) {
    linkBlock(blocks[index], blockLinks, titleOf);
  }
}
