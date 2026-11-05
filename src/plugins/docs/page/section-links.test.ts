import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexLink } from '../contract';
import {
  findRaw,
  linkSections,
  linksByBlock,
  matchText,
} from './section-links';

function link(line: number, form: IndexLink['form'] = 'section'): IndexLink {
  return { form, raw: `§ At ${line}`, target: '/t.md', line, targetLine: null };
}

describe('matchText', () => {
  it.each([
    ['`AGENTS.md` § Intent', 'AGENTS.md § Intent'],
    ['`wigley:make` § Run log › Groups', 'wigley:make § Run log › Groups'],
    ['§ The  \n key', '§ The key'],
    ['§ The **bold** part', '§ The bold part'],
    ['`a.md`\n> § B', 'a.md § B'],
  ])('%s reads as %s', (raw, expected) => {
    expect(matchText(raw)).toBe(expected);
  });
});

describe('findRaw', () => {
  it.each([
    {
      name: 'one run',
      runs: ['see § Intent for more'],
      raw: '§ Intent',
      from: 0,
      expected: {
        start: { run: 0, offset: 4 },
        end: { run: 0, offset: 12 },
        nextIndex: 12,
      },
    },
    {
      name: 'a match that ends on a run boundary',
      runs: ['see ', 'AGENTS.md', ' tail'],
      raw: '`AGENTS.md`',
      from: 0,
      expected: {
        start: { run: 1, offset: 0 },
        end: { run: 1, offset: 9 },
        nextIndex: 13,
      },
    },
    {
      name: 'a raw across runs',
      runs: ['see ', 'AGENTS.md', ' § Intent for more'],
      raw: '`AGENTS.md` § Intent',
      from: 0,
      expected: {
        start: { run: 1, offset: 0 },
        end: { run: 2, offset: 9 },
        nextIndex: 22,
      },
    },
    {
      name: 'a wrap',
      runs: ['a.md\n§ B'],
      raw: '`a.md` § B',
      from: 0,
      expected: {
        start: { run: 0, offset: 0 },
        end: { run: 0, offset: 8 },
        nextIndex: 8,
      },
    },
    {
      name: 'marks and doubled whitespace in the runs, offsets in the runs',
      runs: ['x  *§*  The\n  key'],
      raw: '§ The key',
      from: 0,
      expected: {
        start: { run: 0, offset: 4 },
        end: { run: 0, offset: 17 },
        nextIndex: 11,
      },
    },
    {
      name: 'the second of two equal references, from the first’s nextIndex',
      runs: ['§ A and § A'],
      raw: '§ A',
      from: 3,
      expected: {
        start: { run: 0, offset: 8 },
        end: { run: 0, offset: 11 },
        nextIndex: 11,
      },
    },
    {
      name: 'no match',
      runs: ['see § Other'],
      raw: '§ Intent',
      from: 0,
      expected: null,
    },
    {
      name: 'a mark that renders otherwise',
      runs: ['§ a_b'],
      raw: '§ a\\_b',
      from: 0,
      expected: null,
    },
  ])('$name', ({ runs, raw, from, expected }) => {
    expect(findRaw(runs, raw, from)).toEqual(expected);
  });
});

describe('linksByBlock', () => {
  it('places each link in the last block at or before its body line', () => {
    const inBlock = link(7);
    const inLastBlock = link(12);

    const byBlock = linksByBlock(
      [inBlock, inLastBlock, link(2), link(7, 'markdown')],
      [1, 3, 8],
      4,
    );

    expect([...byBlock]).toEqual([
      [1, [inBlock]],
      [2, [inLastBlock]],
    ]);
  });

  it('keeps the index order within a block', () => {
    const first = link(5);
    const second = link(4);

    expect(linksByBlock([first, second], [1], 1).get(0)).toEqual([
      first,
      second,
    ]);
  });

  it('takes the last block in document order of those on one line', () => {
    const inner = link(3);

    expect(linksByBlock([inner], [1, 3, 3], 1).get(2)).toEqual([inner]);
  });

  it('leaves out a link above the first block', () => {
    expect(linksByBlock([link(2)], [5], 1).size).toBe(0);
  });
});

// The DOM `linkSections` touches, with text nodes, which the shared fake lacks.
class FakeNode {
  parent: FakeTag | null = null;
  get parentNode(): FakeTag | null {
    return this.parent;
  }
  get parentElement(): FakeTag | null {
    return this.parent;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parent?.kids ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  detach(): void {
    this.parent?.kids.splice(this.parent.kids.indexOf(this), 1);
  }
}

class FakeText extends FakeNode {
  readonly nodeType = 3;
  constructor(public data: string) {
    super();
  }
  get length(): number {
    return this.data.length;
  }
  splitText(offset: number): FakeText {
    const rest = new FakeText(this.data.slice(offset));
    this.data = this.data.slice(0, offset);
    rest.parent = this.parent;
    this.parent?.kids.splice(this.parent.kids.indexOf(this) + 1, 0, rest);
    return rest;
  }
}

class FakeTag extends FakeNode {
  readonly nodeType = 1;
  kids: FakeNode[] = [];
  dataset: Record<string, string> = {};
  className = '';
  title = '';
  constructor(
    public tag: string,
    ...kids: (FakeNode | string)[]
  ) {
    super();
    for (const kid of kids) {
      this.append(typeof kid === 'string' ? new FakeText(kid) : kid);
    }
  }
  get firstChild(): FakeNode | null {
    return this.kids[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.kids.at(-1) ?? null;
  }
  append(node: FakeNode): void {
    node.detach();
    node.parent = this;
    this.kids.push(node);
  }
  insertBefore(node: FakeNode, before: FakeNode): void {
    node.detach();
    node.parent = this;
    this.kids.splice(this.kids.indexOf(before), 0, node);
  }
  contains(node: FakeNode): boolean {
    return this.kids.some(
      (kid) => kid === node || (kid instanceof FakeTag && kid.contains(node)),
    );
  }
  normalize(): void {
    this.kids = this.kids.flatMap((kid, index) => {
      const before = this.kids[index - 1];
      if (kid instanceof FakeText && before instanceof FakeText) {
        before.data += kid.data;
        return [];
      }
      return [kid];
    });
  }
  setAttribute(): void {}
  hasAttribute(): boolean {
    return this.dataset.sourceLine !== undefined;
  }
  matches(): boolean {
    return this.tag === 'a' || this.tag === 'pre';
  }
  querySelectorAll(): FakeTag[] {
    return this.kids.flatMap((kid) =>
      kid instanceof FakeTag
        ? [
            ...(kid.dataset.sourceLine === undefined ? [] : [kid]),
            ...kid.querySelectorAll(),
          ]
        : [],
    );
  }
}

// The nodes `filter` accepts under `root`, in document order.
function walked(root: FakeTag, filter: NodeFilter): FakeNode[] {
  const accept = filter as unknown as { acceptNode(node: unknown): number };
  return root.kids.flatMap((kid) => {
    const verdict = accept.acceptNode(kid);
    if (verdict === FILTER.ACCEPT) {
      return [kid];
    }
    return verdict === FILTER.SKIP ? walked(kid as FakeTag, filter) : [];
  });
}

const FILTER = { ACCEPT: 1, REJECT: 2, SKIP: 3 };

function block(line: number, ...kids: (FakeNode | string)[]): FakeTag {
  const tag = new FakeTag('p', ...kids);
  tag.dataset.sourceLine = String(line);
  return tag;
}

// `node` as markup, a section link as `[<line>|text]`.
function drawn(node: FakeNode): string {
  if (node instanceof FakeText) {
    return node.data;
  }
  const tag = node as FakeTag;
  const inner = tag.kids.map(drawn).join('');
  return tag.tag === 'a' && tag.dataset.docPath !== undefined
    ? `[${tag.dataset.docLine ?? ''}|${inner}]`
    : `<${tag.tag}>${inner}</${tag.tag}>`;
}

function sectionLink(raw: string, targetLine: number | null = 7): IndexLink {
  return { form: 'section', raw, target: '/t.md', line: 1, targetLine };
}

describe('linkSections', () => {
  beforeEach(() => {
    vi.stubGlobal('Node', { TEXT_NODE: 3 });
    vi.stubGlobal('NodeFilter', {
      SHOW_ELEMENT: 1,
      SHOW_TEXT: 4,
      FILTER_ACCEPT: FILTER.ACCEPT,
      FILTER_REJECT: FILTER.REJECT,
      FILTER_SKIP: FILTER.SKIP,
    });
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeTag(tag),
      createTreeWalker: (root: FakeTag, _show: number, filter: NodeFilter) => {
        const nodes = walked(root, filter);
        const walker = {
          currentNode: root as FakeNode,
          nextNode() {
            walker.currentNode = nodes.shift() as FakeNode;
            return walker.currentNode ?? null;
          },
        };
        return walker;
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    name: string;
    kids: () => (FakeNode | string)[];
    links: IndexLink[];
    expected: string;
  }>([
    {
      name: 'a match inside one text node',
      kids: () => ['see § A for more'],
      links: [sectionLink('§ A')],
      expected: 'see [7|§ A] for more',
    },
    {
      name: 'a match with no target line',
      kids: () => ['§ A'],
      links: [sectionLink('§ A', null)],
      expected: '[|§ A]',
    },
    {
      name: 'two matches, wrapped last first with the first still in place',
      kids: () => ['§ A then § B.'],
      links: [sectionLink('§ A', 3), sectionLink('§ B', 4)],
      expected: '[3|§ A] then [4|§ B].',
    },
    {
      name: 'a match across an inline element it begins with',
      kids: () => ['see ', new FakeTag('code', 'a.md'), ' § A now'],
      links: [sectionLink('`a.md` § A')],
      expected: 'see [7|<code>a.md</code> § A] now',
    },
    {
      name: 'a match across an inline element it ends with',
      kids: () => ['§ A ', new FakeTag('code', 'b'), ' tail'],
      links: [sectionLink('§ A `b`')],
      expected: '[7|§ A <code>b</code>] tail',
    },
    {
      name: 'a match that begins inside an element it does not enclose',
      kids: () => [new FakeTag('em', 'x § '), 'A tail'],
      links: [sectionLink('§ A')],
      expected: '<em>x § </em>A tail',
    },
    {
      name: 'text inside a link is not read',
      kids: () => [new FakeTag('a', '§ A'), ' § A'],
      links: [sectionLink('§ A')],
      expected: '<a>§ A</a> [7|§ A]',
    },
    {
      name: 'text inside a nested block is not read',
      kids: () => [block(2, '§ A'), ' § A'],
      links: [sectionLink('§ A')],
      expected: '<p>§ A</p> [7|§ A]',
    },
    {
      name: 'no match',
      kids: () => ['§ Other'],
      links: [sectionLink('§ A')],
      expected: '§ Other',
    },
  ])('$name', ({ kids, links, expected }) => {
    const shown = block(1, ...kids());
    const body = new FakeTag('div', shown);

    linkSections(body as unknown as HTMLElement, links, 1, () => 'title');

    expect(shown.kids.map(drawn).join('')).toBe(expected);
  });
});
