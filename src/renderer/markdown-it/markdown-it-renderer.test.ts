import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeHighlighter } from '../../contracts/highlight';
import type {
  BlockContribution,
  FenceContribution,
} from '../../contracts/markdown';
import { createMarkdownItRenderer } from './markdown-it-renderer';

// A live `html` contribution that is never mounted here.
const htmlFence: FenceContribution = {
  language: 'html',
  live: true,
  mount: () => {
    throw new Error('not mounted in adapter tests');
  },
};

// Knows only `ts`, which it wraps whole in a keyword span.
const highlightCalls: { code: string; language: string }[] = [];
const highlighter: CodeHighlighter = {
  highlight: (code, language) => {
    highlightCalls.push({ code, language });
    const html =
      language === 'ts' ? `<span class="tok-keyword">${code}</span>` : null;
    return Promise.resolve(html);
  },
};

// Its header escaped into an attribute, its body drawn as block markdown.
const noteBlock: BlockContribution = {
  name: 'note',
  render: ({ header, body }, helpers) =>
    `<div class="note" data-header="${helpers.escape(header)}">${helpers.block(body.join('\n'))}</div>\n`,
};

// One item per body line, each drawn as inline markdown.
const linesBlock: BlockContribution = {
  name: 'lines',
  render: ({ body }, helpers) =>
    `<ol class="lines">${body.map((line) => `<li>${helpers.inline(line)}</li>`).join('')}</ol>\n`,
};

// Draws `para`, which no body line holds.
const fixedBlock: BlockContribution = {
  name: 'fixed',
  render: (_block, helpers) => helpers.block('para'),
};

// Draws its own opener again, as text no body line holds.
const selfBlock: BlockContribution = {
  name: 'self',
  render: (_block, helpers) =>
    `<div class="self">${helpers.block(':::self\nx\n:::')}</div>\n`,
};

const brokenBlock: BlockContribution = {
  name: 'broken',
  render: () => {
    throw new Error('a plugin bug');
  },
};

const markdown = createMarkdownItRenderer(highlighter);
for (const contribution of [
  noteBlock,
  linesBlock,
  fixedBlock,
  selfBlock,
  brokenBlock,
]) {
  markdown.addBlock(contribution);
}

// The marks `data-md-lines` carries are pinned once, in `cursor block marks`;
// every other row compares the markup without them.
function withoutLineMarks(html: string): string {
  return html.replace(/ data-md-lines="[^"]*"/g, '');
}

function block(text: string): string {
  return withoutLineMarks(markdown.block(text));
}

describe('escaping and disabled syntax', () => {
  it('escapes a script tag', () => {
    const html = block('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows a raw HTML block as text', () => {
    const html = block('<div onclick="x">hi</div>');
    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;div onclick=&quot;x&quot;&gt;hi&lt;/div&gt;');
  });

  it.each([
    [
      'a link',
      '[site](https://example.com)',
      '<p><a class="md-link" href="#" data-href="https://example.com" title="https://example.com">site</a></p>\n',
    ],
    [
      'an autolink',
      '<https://example.com>',
      '<p><a class="md-link" href="#" data-href="https://example.com" title="https://example.com">https://example.com</a></p>\n',
    ],
    [
      'a bare URL',
      'see http://example.com/a?b=1 now',
      '<p>see <a class="md-link" href="#" data-href="http://example.com/a?b=1" title="http://example.com/a?b=1">http://example.com/a?b=1</a> now</p>\n',
    ],
  ])('renders %s to a web page as a link', (_case, text, html) => {
    expect(block(text)).toBe(html);
  });

  it.each([
    ['a relative link', '[guide](docs/a.md)'],
    ['an empty link', '[x]()'],
    ['a file link', '[x](file:///etc/hosts)'],
    ['a javascript link', '[x](javascript:alert(1))'],
    ['a bare host', 'see example.com or a.md now'],
    ['a URL in code', '`https://example.com`'],
  ])('keeps %s as text', (_case, text) => {
    expect(block(text)).not.toContain('<a');
  });

  it('shows an image as its alt text', () => {
    expect(block('![alt](https://example.com/p.png)')).toBe(
      '<p><span class="md-image">alt</span></p>\n',
    );
  });

  it('shows a reference definition as text instead of dropping it', () => {
    const html = block('[ref]\n\n[ref]: https://example.com');
    expect(html).toContain('<p>[ref]</p>');
    expect(html).toContain('<p>[ref]: <a class="md-link"');
  });
});

describe('inline()', () => {
  it('renders code and emphasis and escapes HTML, with no paragraph', () => {
    expect(markdown.inline('use `foo` **here** <b>')).toBe(
      'use <code>foo</code> <strong>here</strong> &lt;b&gt;',
    );
  });

  it('renders a web link as a link and any other as text', () => {
    expect(markdown.inline('[x](https://example.com)')).toBe(
      '<a class="md-link" href="#" data-href="https://example.com" title="https://example.com">x</a>',
    );
    expect(markdown.inline('[x](docs/a.md)')).toBe('[x](docs/a.md)');
    expect(markdown.inline('[x]()')).toBe('x');
  });
});

describe('headings', () => {
  it('renders a heading as a classed paragraph, never a heading element', () => {
    const html = block('### A section\n\nBody text.');
    expect(html).toContain('<p class="md-h md-h3">A section</p>');
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain('<p>Body text.</p>');
  });

  it('keeps every level as a class', () => {
    for (let level = 1; level <= 6; level++) {
      expect(block(`${'#'.repeat(level)} Title`)).toBe(
        `<p class="md-h md-h${level}">Title</p>\n`,
      );
    }
  });
});

describe('cursor block marks', () => {
  const markedTags = (html: string) =>
    html.match(/<[^>]*data-md-lines="[^"]*"[^>]*>/g) ?? [];

  it.each([
    {
      name: 'a heading, paragraph, fence and top-level list items',
      text: '# Title\n\nFirst para\nsecond line\n\n```ts\ncode\n```\n\n- one\n  - nested\n- two',
      tags: [
        '<p class="md-h md-h1" data-md-lines="0,1">',
        '<p data-md-lines="2,4">',
        '<pre data-md-lines="5,8">',
        '<li data-md-lines="9,11">',
        '<li data-md-lines="11,12">',
      ],
    },
    {
      name: 'an ordered list, by its items',
      text: '1. one\n2. two',
      tags: ['<li data-md-lines="0,1">', '<li data-md-lines="1,2">'],
    },
    {
      name: 'a table and a quote of two paragraphs, once each',
      text: '| a | b |\n| --- | --- |\n| c | d |\n\n> one\n>\n> two',
      tags: ['<table data-md-lines="0,3">', '<blockquote data-md-lines="4,7">'],
    },
    {
      name: 'a contributed fence on its placeholder',
      text: '```diff\n+ a\n```',
      tags: [
        '<div class="md-fence" data-fence-language="diff" data-fence-closed="true" data-md-lines="0,3">',
      ],
    },
    {
      name: 'a plain fence and an indented code block on pre, never code',
      text: '```ts\ncode\n```\n\n    indented',
      tags: ['<pre data-md-lines="0,3">', '<pre data-md-lines="4,5">'],
    },
    {
      name: 'a fence in a quote, which gets no mark of its own',
      text: '> ```ts\n> x\n> ```',
      tags: ['<blockquote data-md-lines="0,3">'],
    },
    {
      name: 'a contributed block once, from opener to the line after the closer',
      text: ':::note S\nbody\n\n- item\n:::\n\n:::lines\na\n:::',
      tags: [
        '<div class="note" data-header="S" data-md-lines="0,5">',
        '<ol class="lines" data-md-lines="6,9">',
      ],
    },
  ])('block_marksCursorBlocks: $name', ({ text, tags }) => {
    expect(markedTags(markdown.block(text))).toEqual(tags);
  });
});

describe('tables', () => {
  it('aligns cells by class, not by style', () => {
    const html = block(
      '| left | middle | right | plain |\n' +
        '| :--- | :---: | ---: | --- |\n' +
        '| a | b | c | d |',
    );
    expect(html).toContain('<th class="md-left">left</th>');
    expect(html).toContain('<th class="md-center">middle</th>');
    expect(html).toContain('<th class="md-right">right</th>');
    expect(html).toContain('<th>plain</th>');
    expect(html).toContain('<td class="md-center">b</td>');
    expect(html).toContain('<td class="md-right">c</td>');
    expect(html).toContain('<td>d</td>');
    expect(html).not.toContain('style=');
  });
});

describe('fences', () => {
  it('keeps markdown-it’s language class on other fences', () => {
    expect(block('```ts\nconst a = 1;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1;\n</code></pre>\n',
    );
  });

  it.each([
    {
      name: 'added, removed and changed lines',
      source: '+ a\n- b\n~ c\n same\n',
      code:
        '<code>' +
        '<span class="md-diff-add">+ a</span>\n' +
        '<span class="md-diff-del">- b</span>\n' +
        '<span class="md-diff-mod">~ c</span>\n' +
        ' same</code>',
    },
    {
      name: 'escaped lines',
      source: '+ <b>&\n',
      code: '<code><span class="md-diff-add">+ &lt;b&gt;&amp;</span></code>',
    },
  ])('draws a diff fence’s $name', ({ source, code }) => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => ({
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
      }),
    });
    try {
      const view = markdown.fence('diff')!.mount(source, true);

      expect(view.element.className).toBe('md-diff');
      expect(view.element.innerHTML).toBe(code);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a block opener inside a fence as code', () => {
    expect(block('```\n:::changes\n```')).toBe(
      '<pre><code>:::changes\n</code></pre>\n',
    );
  });
});

describe('fence contributions', () => {
  const withHtml = createMarkdownItRenderer(highlighter);
  withHtml.addFence(htmlFence);
  const placeholder = (closed: boolean, code: string, attrs = '') =>
    `<div class="md-fence" data-fence-language="html" data-fence-closed="${closed}"${attrs}>` +
    `<pre><code class="language-html">${code}</code></pre></div>\n`;

  it.each([
    {
      name: 'a closed block',
      text: '```html\n<b>x</b>\n```',
      html: placeholder(true, '&lt;b&gt;x&lt;/b&gt;\n'),
    },
    {
      name: 'a block with no closing fence',
      text: '```html\n<b>x</b>\n',
      html: placeholder(false, '&lt;b&gt;x&lt;/b&gt;\n'),
    },
    {
      name: 'a block whose closer is indented four spaces',
      text: '```html\nx\n    ```\n',
      html: placeholder(false, 'x\n    ```\n'),
    },
    {
      name: 'a block in a blockquote',
      text: '> ```html\n> x\n> ```',
      html: `<blockquote>\n${placeholder(true, 'x\n')}</blockquote>\n`,
    },
    {
      name: 'an opener alone',
      text: '```html',
      html: placeholder(false, ''),
    },
    {
      name: 'an empty closed block',
      text: '```html\n```',
      html: placeholder(true, ''),
    },
    {
      name: 'a tilde block',
      text: '~~~html\nx\n~~~',
      html: placeholder(true, 'x\n'),
    },
    {
      name: 'a block whose closer is longer than its opener',
      text: '```html\nx\n`````',
      html: placeholder(true, 'x\n'),
    },
    {
      name: 'an upper-case info string',
      text: '```HTML\nx\n```',
      html: placeholder(true, 'x\n'),
    },
  ])('emits a placeholder for $name', ({ text, html }) => {
    expect(withoutLineMarks(withHtml.block(text))).toBe(html);
  });

  it('emits a placeholder for a closed document fence', async () => {
    expect(await withHtml.document('```html\nx\n```')).toBe(
      placeholder(true, 'x\n', ' data-source-line="1"'),
    );
  });

  it('registers, refuses a second and unregisters a fence', () => {
    const renderer = createMarkdownItRenderer(highlighter);
    const first = renderer.addFence(htmlFence);

    expect(renderer.fence('html')).toBe(htmlFence);
    expect(renderer.fence(' HTML ')).toBe(htmlFence);
    expect(() => renderer.addFence({ ...htmlFence })).toThrow(
      'fence html is already registered',
    );
    expect(() => renderer.addFence({ ...htmlFence, language: 'Html' })).toThrow(
      'fence html is already registered',
    );
    expect(() => renderer.addFence({ ...htmlFence, language: 'diff' })).toThrow(
      'fence diff is already registered',
    );
    first.dispose();
    expect(renderer.fence('html')).toBeUndefined();
    expect(withoutLineMarks(renderer.block('```html\nx\n```'))).toBe(
      '<pre><code class="language-html">x\n</code></pre>\n',
    );
    const second = { ...htmlFence };
    renderer.addFence(second);
    first.dispose();
    expect(renderer.fence('html')).toBe(second);
  });
});

describe('block contributions', () => {
  it.each([
    {
      name: 'the header and the body lines reach render, indent rebuilt from columns and a blank line as empty',
      text: ':::lines\na\n  b\n\nc\n:::',
      html: '<ol class="lines"><li>a</li><li>  b</li><li></li><li>c</li></ol>\n',
    },
    {
      name: 'an empty header is empty',
      text: ':::note\nx\n:::',
      html: '<div class="note" data-header=""><p>x</p>\n</div>\n',
    },
    {
      name: 'the header is escaped through escape',
      text: ':::note <b>\nx\n:::',
      html: '<div class="note" data-header="&lt;b&gt;"><p>x</p>\n</div>\n',
    },
    {
      name: 'an inline request renders inline markdown and escapes HTML',
      text: ':::lines\n**b** <i>\n:::',
      html: '<ol class="lines"><li><strong>b</strong> &lt;i&gt;</li></ol>\n',
    },
    {
      name: 'an unregistered name is text',
      text: ':::other\nx\n:::',
      html: '<p>:::other\nx\n:::</p>\n',
    },
    {
      name: 'an opener ends the paragraph before it',
      text: 'Intro\n:::note\nx\n:::',
      html: '<p>Intro</p>\n<div class="note" data-header=""><p>x</p>\n</div>\n',
    },
    {
      name: 'an opener indented four spaces is code',
      text: '    :::note\n    x\n    :::',
      html: '<pre><code>:::note\nx\n:::\n</code></pre>\n',
    },
    {
      name: 'nested blocks close innermost first',
      text: ':::note A\n:::note B\nin\n:::\nmid\n:::\nout',
      html:
        '<div class="note" data-header="A">' +
        '<div class="note" data-header="B"><p>in</p>\n</div>\n' +
        '<p>mid</p>\n</div>\n<p>out</p>\n',
    },
    {
      name: 'a fenced closer inside a body stays code',
      text: ':::note S\n```\n:::\n```\nafter\n:::\nout',
      html:
        '<div class="note" data-header="S"><pre><code>:::\n</code></pre>\n' +
        '<p>after</p>\n</div>\n<p>out</p>\n',
    },
    {
      name: 'a fenced opener inside a body stays code',
      text: ':::note S\n```\n:::note X\n```\nafter\n:::\nout',
      html:
        '<div class="note" data-header="S"><pre><code>:::note X\n</code></pre>\n' +
        '<p>after</p>\n</div>\n<p>out</p>\n',
    },
    {
      name: 'a closer inside a tilde fence stays code',
      text: ':::note S\n~~~\n:::\n~~~\nafter\n:::\nout',
      html:
        '<div class="note" data-header="S"><pre><code>:::\n</code></pre>\n' +
        '<p>after</p>\n</div>\n<p>out</p>\n',
    },
    {
      name: 'an unclosed block runs to the end',
      text: ':::note S\nbody',
      html: '<div class="note" data-header="S"><p>body</p>\n</div>\n',
    },
    {
      name: 'a nested opener in a lines body moves only the close line',
      text: ':::lines\n:::note\nx\n:::\ny\n:::\nafter',
      html:
        '<ol class="lines"><li>:::note</li><li>x</li><li>:::</li><li>y</li></ol>\n' +
        '<p>after</p>\n',
    },
    {
      name: 'a bare closer with no open block is text',
      text: ':::',
      html: '<p>:::</p>\n',
    },
    {
      name: 'a block whose render throws draws its opener and body as text',
      text: ':::broken H\na <b>\n\n:::\nafter',
      html: '<p>:::broken H</p>\n<p>a &lt;b&gt;</p>\n<p>after</p>\n',
    },
    {
      name: 'a block that draws its own opener stops at markdown-it’s maxNesting of 100',
      text: ':::self\nx\n:::',
      html: '<div class="self">'.repeat(100) + '</div>\n'.repeat(100),
    },
  ])('block_drawsContributedBlocks: $name', ({ text, html }) => {
    expect(block(text)).toBe(html);
  });

  it('blocks_BlockTextNotInBody_RendersWithoutMarks', async () => {
    expect(await markdown.document(':::fixed\nx\n:::')).toBe('<p>para</p>\n');
  });

  it('addBlock_SecondOfAName_Throws_DisposeUnregisters', () => {
    const renderer = createMarkdownItRenderer(highlighter);
    const bold: BlockContribution = { name: 'x', render: () => '<b>x</b>\n' };
    const first = renderer.addBlock(bold);

    expect(() => renderer.addBlock({ ...bold })).toThrow(
      'block x is already registered',
    );
    expect(() => renderer.addBlock({ ...bold, name: 'X' })).toThrow(
      'block name "X" must match [a-z][a-z0-9-]*',
    );
    expect(withoutLineMarks(renderer.block(':::x'))).toBe('<b>x</b>\n');
    first.dispose();
    expect(withoutLineMarks(renderer.block(':::x'))).toBe('<p>:::x</p>\n');
    const italic: BlockContribution = { name: 'x', render: () => '<i>y</i>\n' };
    renderer.addBlock(italic);
    first.dispose();
    expect(withoutLineMarks(renderer.block(':::x'))).toBe('<i>y</i>\n');
  });
});

describe('document()', () => {
  beforeEach(() => {
    highlightCalls.length = 0;
  });

  const render = (text: string) => markdown.document(text);

  it('renders a link as an anchor the view intercepts', async () => {
    expect(await render('[guide](docs/a.md#L3)')).toBe(
      '<p data-source-line="1"><a class="md-link" href="#" data-href="docs/a.md#L3" title="docs/a.md#L3">guide</a></p>\n',
    );
  });

  it("uses the link's own title", async () => {
    expect(await render('[x](https://e.com "Home")')).toContain('title="Home"');
  });

  it('percent-encodes a spaced path', async () => {
    expect(await render('[a](<my doc.md>)')).toContain(
      'data-href="my%20doc.md"',
    );
  });

  it('renders an autolink', async () => {
    expect(await render('<https://example.com>')).toContain(
      'data-href="https://example.com"',
    );
  });

  it('keeps a javascript link and a bare host as text', async () => {
    expect(await render('[x](javascript:alert(1))')).not.toContain('<a');
    expect(await render('see e.com')).not.toContain('<a');
  });

  it('renders a bare URL as a link', async () => {
    expect(await render('see https://e.com')).toContain(
      'data-href="https://e.com"',
    );
  });

  it('renders an image as its alt text', async () => {
    expect(await render('![a diagram](pic.png)')).toBe(
      '<p data-source-line="1"><span class="md-image">a diagram</span></p>\n',
    );
  });

  it('gives headings anchors by the slug rule', async () => {
    expect(await render('## Core services & seams')).toBe(
      '<h2 data-anchor="core-services--seams" data-source-line="1">Core services &amp; seams</h2>\n',
    );
    expect(await render('# Use `npm test`')).toContain(
      'data-anchor="use-npm-test"',
    );
    expect(await render('## Plan A — layout')).toContain(
      '<h2 data-anchor="plan-a--layout" data-source-line="1">',
    );
    expect(await render('## Café')).toContain('data-anchor="café"');
  });

  it('numbers a repeated slug', async () => {
    expect(await render('# A\n\n# A')).toBe(
      '<h1 data-anchor="a" data-source-line="1">A</h1>\n' +
        '<h1 data-anchor="a-1" data-source-line="3">A</h1>\n',
    );
  });

  it('highlights a known fence', async () => {
    expect(await render('```ts\nconst\n```')).toBe(
      '<pre data-source-line="1"><code class="language-ts"><span class="tok-keyword">const\n</span></code></pre>\n',
    );
  });

  it('renders an unknown fence plain', async () => {
    expect(await render('```zzz\nx < y\n```')).toBe(
      '<pre data-source-line="1"><code class="language-zzz">x &lt; y\n</code></pre>\n',
    );
  });

  it('renders a fence plain when its language fails to load', async () => {
    const failing = createMarkdownItRenderer({
      highlight: (code, language) =>
        language === 'broken'
          ? Promise.reject(new Error('import failed'))
          : highlighter.highlight(code, language),
    });
    expect(
      await failing.document('```broken\nx < y\n```\n\n```ts\nconst\n```'),
    ).toBe(
      '<pre data-source-line="1"><code class="language-broken">x &lt; y\n</code></pre>\n' +
        '<pre data-source-line="5"><code class="language-ts"><span class="tok-keyword">const\n</span></code></pre>\n',
    );
  });

  it('gives a fence with no language no language class', async () => {
    expect(await render('```\na\n```')).toBe(
      '<pre data-source-line="1"><code>a\n</code></pre>\n',
    );
  });

  it('highlights a live contributed fence inside its placeholder, and no diff', async () => {
    const withTs = createMarkdownItRenderer(highlighter);
    withTs.addFence({ ...htmlFence, language: 'ts' });

    const html = await withTs.document(
      '```ts\nconst\n```\n\n```diff\n+ a\n```',
    );

    expect(html).toContain(
      '<div class="md-fence" data-fence-language="ts" data-fence-closed="true" data-source-line="1">' +
        '<pre><code class="language-ts"><span class="tok-keyword">const\n</span></code></pre></div>\n',
    );
    expect(highlightCalls).toEqual([{ code: 'const\n', language: 'ts' }]);
  });

  it('highlights a fence inside a block', async () => {
    const html = await render(':::note S\n```ts\nx\n```\n:::');
    expect(html).toContain(
      '<pre data-source-line="2"><code class="language-ts"><span class="tok-keyword">x\n</span></code></pre>',
    );
  });

  it('escapes raw HTML', async () => {
    const html = await render('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('holds no cursor block mark', async () => {
    const html = await render(
      '# T\n\npara\n\n- a\n\n```ts\nx\n```\n\n:::note S\nbody\n:::',
    );
    expect(html).not.toContain('data-md-lines');
  });

  it('marks blocks, list items and tables with their source line', async () => {
    const html = await render(
      '# T\n\npara\n\n- a\n- b\n\n| a | b |\n| --- | --- |\n| one | two |\n\n:::note S\nbody\n:::\n\n:::lines\n+ a\n:::\n\n:::lines\nroot\n:::',
    );
    for (const tag of [
      '<h1 data-anchor="t" data-source-line="1">',
      '<p data-source-line="3">',
      '<ul data-source-line="5">',
      '<li data-source-line="5">',
      '<li data-source-line="6">',
      '<table data-source-line="8">',
      '<div class="note" data-header="S" data-source-line="12">',
      '<ol class="lines" data-source-line="16">',
      '<ol class="lines" data-source-line="20">',
    ]) {
      expect(html).toContain(tag);
    }
  });
});
