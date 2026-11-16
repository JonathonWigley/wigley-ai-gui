import type { MarkdownRenderer } from '../../contracts/markdown';
import { FakeElement, installFakeDom } from './test-dom';

// The fence and block registries of a MarkdownRenderer fake that registers no
// fence and no block.
export const NO_FENCES: Pick<
  MarkdownRenderer,
  'addFence' | 'fence' | 'addBlock'
> = {
  addFence: () => ({ dispose: () => undefined }),
  fence: () => undefined,
  addBlock: () => ({ dispose: () => undefined }),
};

// A renderer that hands every text back as it is and registers no fence and
// no block.
export const PLAIN_MARKDOWN: MarkdownRenderer = {
  block: (text) => text,
  inline: (text) => text,
  document: async (text) => text,
  ...NO_FENCES,
};

// The placeholder `block` emits for a contributed fence. `source` is written
// unescaped: give it no `<`, `>` or `&`.
export function fencePlaceholder(
  language: string,
  closed: boolean,
  source: string,
): string {
  return (
    `<div class="md-fence" data-fence-language="${language}" data-fence-closed="${closed}">` +
    `<pre><code class="language-${language}">${source}</code></pre></div>\n`
  );
}

const PLACEHOLDER =
  /<div class="md-fence" data-fence-language="([^"]*)" data-fence-closed="(true|false)"><pre><code class="language-[^"]*">([^<]*)<\/code><\/pre><\/div>\n/g;

// Each `moveBefore` that ran: the node moved and the element it moved into.
type Moves = { element: unknown; to: unknown }[];

// A FakeElement whose `innerHTML` builds each `fencePlaceholder` it is set
// to as a `div.md-fence` holding `pre > code`, and the text between as text
// nodes; `moveBefore` moves a node between connected elements, as Chromium's
// does, recording it in `moves`.
class MarkdownFakeElement extends FakeElement {
  constructor(
    tag: string,
    private readonly moves: Moves,
  ) {
    super(tag);
    let html = '';
    Object.defineProperty(this, 'innerHTML', {
      get: () => html,
      set: (value: string) => {
        html = value;
        this.replaceChildren(...parseFences(value, moves));
      },
    });
  }

  moveBefore(node: FakeElement, reference: FakeElement | null) {
    if (!this.isConnected || !node.isConnected) {
      const error = new Error('moveBefore needs connected nodes');
      error.name = 'HierarchyRequestError';
      throw error;
    }
    this.insertBefore(node, reference);
    this.moves.push({ element: node, to: this });
  }
}

function parseFences(html: string, moves: Moves): (FakeElement | string)[] {
  const nodes: (FakeElement | string)[] = [];
  let end = 0;
  for (const match of html.matchAll(PLACEHOLDER)) {
    if (match.index > end) {
      nodes.push(html.slice(end, match.index));
    }
    nodes.push(placeholderElement(match[1], match[2], match[3], moves));
    end = match.index + match[0].length;
  }
  if (end < html.length) {
    nodes.push(html.slice(end));
  }
  return nodes;
}

function placeholderElement(
  language: string,
  closed: string,
  source: string,
  moves: Moves,
): FakeElement {
  const placeholder = new MarkdownFakeElement('div', moves);
  placeholder.className = 'md-fence';
  placeholder.dataset.fenceLanguage = language;
  placeholder.dataset.fenceClosed = closed;
  const pre = new MarkdownFakeElement('pre', moves);
  const code = new MarkdownFakeElement('code', moves);
  code.textContent = source;
  pre.append(code);
  placeholder.append(pre);
  return placeholder;
}

// `installFakeDom` with a `document` whose elements parse fence placeholders
// out of the `innerHTML` they are set to and take `moveBefore`; `moves`
// records each `moveBefore`.
export function installMarkdownDom(
  stubGlobal: (name: string, value: unknown) => void,
): { moves: Moves } {
  installFakeDom(stubGlobal);
  const moves: Moves = [];
  stubGlobal('document', {
    createElement: (tag: string) => new MarkdownFakeElement(tag, moves),
  });
  return { moves };
}
