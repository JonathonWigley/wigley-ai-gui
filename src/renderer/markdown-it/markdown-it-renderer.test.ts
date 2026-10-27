import { beforeEach, describe, expect, it } from 'vitest';
import type { CodeHighlighter } from '../../contracts/highlight';
import { createMarkdownItRenderer } from './markdown-it-renderer';

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

const markdown = createMarkdownItRenderer(highlighter);

function block(text: string): string {
  return markdown.block(text);
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

  it('shows links, images, autolinks and bare URLs as text', () => {
    expect(block('[site](https://example.com)')).toBe(
      '<p>[site](https://example.com)</p>\n',
    );
    expect(block('![alt](pic.png)')).toBe('<p>![alt](pic.png)</p>\n');
    expect(block('<https://example.com>')).toBe(
      '<p>&lt;https://example.com&gt;</p>\n',
    );
    expect(block('see https://example.com now')).toBe(
      '<p>see https://example.com now</p>\n',
    );
  });

  it('shows a reference definition as text instead of dropping it', () => {
    const html = block('[ref]\n\n[ref]: https://example.com');
    expect(html).toContain('[ref]: https://example.com');
    expect(html).not.toContain('<a');
  });
});

describe('inline()', () => {
  it('renders code and emphasis and escapes HTML, with no paragraph', () => {
    expect(markdown.inline('use `foo` **here** <b>')).toBe(
      'use <code>foo</code> <strong>here</strong> &lt;b&gt;',
    );
  });

  it('shows a link as text', () => {
    expect(markdown.inline('[x](https://example.com)')).toBe(
      '[x](https://example.com)',
    );
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

  it('colours a diff fence’s added, removed and changed lines', () => {
    expect(block('```diff\n+ a\n- b\n~ c\n same\n```')).toBe(
      '<pre class="md-diff"><code>' +
        '<span class="md-diff-add">+ a</span>\n' +
        '<span class="md-diff-del">- b</span>\n' +
        '<span class="md-diff-mod">~ c</span>\n' +
        ' same</code></pre>\n',
    );
  });

  it('escapes a diff fence’s lines', () => {
    expect(block('```diff\n+ <b>&\n```')).toBe(
      '<pre class="md-diff"><code><span class="md-diff-add">+ &lt;b&gt;&amp;</span></code></pre>\n',
    );
  });

  it('keeps a block opener inside a fence as code', () => {
    expect(block('```\n:::changes\n```')).toBe(
      '<pre><code>:::changes\n</code></pre>\n',
    );
  });
});

describe(':::changes', () => {
  it('renders one pill per marker and escapes markup', () => {
    const html = block(':::changes\n+ add <x>\n~ edit\nx drop\n:::');
    expect(html).toBe(
      '<ul class="md-changes">' +
        '<li class="md-change added"><span class="md-pill">added</span><span class="md-change-text">add &lt;x&gt;</span></li>' +
        '<li class="md-change changed"><span class="md-pill">changed</span><span class="md-change-text">edit</span></li>' +
        '<li class="md-change removed"><span class="md-pill">removed</span><span class="md-change-text">drop</span></li>' +
        '</ul>\n',
    );
  });

  it('draws a dash or star bullet as plain text', () => {
    expect(block(':::changes\n- a fact\n* another\n:::')).toBe(
      '<ul class="md-changes">' +
        '<li class="md-change"><span class="md-change-text">a fact</span></li>' +
        '<li class="md-change"><span class="md-change-text">another</span></li>' +
        '</ul>\n',
    );
  });

  it('renders inline markdown in a change line', () => {
    expect(block(':::changes\n+ **bold** `code`\n:::')).toContain(
      '<span class="md-change-text"><strong>bold</strong> <code>code</code></span>',
    );
  });

  it('skips blank lines and runs to the end when unclosed', () => {
    expect(block(':::changes\n+ a\n\n+ b')).toBe(
      '<ul class="md-changes">' +
        '<li class="md-change added"><span class="md-pill">added</span><span class="md-change-text">a</span></li>' +
        '<li class="md-change added"><span class="md-pill">added</span><span class="md-change-text">b</span></li>' +
        '</ul>\n',
    );
  });

  it('ends the paragraph before it', () => {
    expect(block('Intro\n:::changes\n+ a\n:::')).toContain(
      '<p>Intro</p>\n<ul class="md-changes">',
    );
  });

  it('leaves a bare closer with no open block as text', () => {
    expect(block(':::')).toBe('<p>:::</p>\n');
  });
});

describe(':::tree', () => {
  it('nests by two-space indent and returns to a shallower level', () => {
    expect(block(':::tree\nroot\n  child\n    leaf\n  other\nlast\n:::')).toBe(
      '<ul class="md-tree">' +
        '<li class="md-change"><span class="md-change-text">root</span>' +
        '<ul><li class="md-change"><span class="md-change-text">child</span>' +
        '<ul><li class="md-change"><span class="md-change-text">leaf</span></li></ul></li>' +
        '<li class="md-change"><span class="md-change-text">other</span></li></ul></li>' +
        '<li class="md-change"><span class="md-change-text">last</span></li>' +
        '</ul>\n',
    );
  });

  it('gives a line without a marker no pill', () => {
    const html = block(':::tree\nplain\n  + added\n:::');
    expect(html).toContain(
      '<li class="md-change"><span class="md-change-text">plain</span>',
    );
    expect(html).toContain(
      '<li class="md-change added"><span class="md-pill">added</span>',
    );
    expect(html.split('<span class="md-pill">').length - 1).toBe(1);
  });

  it('measures levels from the first line’s indent', () => {
    expect(block(':::tree\n  ~ a\n  ~ b\n    ~ c\n:::')).toBe(
      '<ul class="md-tree">' +
        '<li class="md-change changed"><span class="md-pill">changed</span><span class="md-change-text">a</span></li>' +
        '<li class="md-change changed"><span class="md-pill">changed</span><span class="md-change-text">b</span>' +
        '<ul><li class="md-change changed"><span class="md-pill">changed</span><span class="md-change-text">c</span></li></ul></li>' +
        '</ul>\n',
    );
  });

  it('clamps a line less indented than the first to the root', () => {
    expect(block(':::tree\n    a\n  b\n:::')).not.toContain('<ul>');
  });

  it('nests a line at most one level below the line before it', () => {
    const html = block(':::tree\nroot\n      deep\n:::');
    expect(html.split('<ul>').length - 1).toBe(1);
  });
});

describe(':::details', () => {
  it('renders its body as markdown and escapes once', () => {
    const html = block(':::details Sum\nbody **bold** a<b\n:::');
    expect(html).toContain(
      '<details class="md-details"><summary>Sum</summary>',
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('a&lt;b');
    expect(html).not.toContain('&amp;lt;');
  });

  it('defaults the summary to Details', () => {
    expect(block(':::details\nbody\n:::')).toBe(
      '<details class="md-details"><summary>Details</summary>\n<p>body</p>\n</details>\n',
    );
  });

  it('renders inline markdown in the summary and escapes HTML there', () => {
    expect(block(':::details Why **this**\nx\n:::')).toContain(
      '<summary>Why <strong>this</strong></summary>',
    );
    expect(block(':::details <b>\nx\n:::')).toContain(
      '<summary>&lt;b&gt;</summary>',
    );
  });

  it('runs to the end when unclosed', () => {
    expect(block(':::details S\nbody')).toBe(
      '<details class="md-details"><summary>S</summary>\n<p>body</p>\n</details>\n',
    );
  });

  it('closes nested details innermost first', () => {
    expect(
      block(':::details Outer\n:::details Inner\nin\n:::\nmid\n:::\nout'),
    ).toBe(
      '<details class="md-details"><summary>Outer</summary>\n' +
        '<details class="md-details"><summary>Inner</summary>\n<p>in</p>\n</details>\n' +
        '<p>mid</p>\n</details>\n<p>out</p>\n',
    );
  });

  it('keeps a change block inside the disclosure', () => {
    const html = block(':::details Full\n:::changes\n+ a\n:::\nmore text\n:::');
    expect(
      html.startsWith('<details class="md-details"><summary>Full</summary>'),
    ).toBe(true);
    expect(html).toContain('<ul class="md-changes">');
    expect(html.endsWith('<p>more text</p>\n</details>\n')).toBe(true);
    expect(html).not.toContain(':::');
  });

  it('keeps a tree block inside the disclosure', () => {
    const html = block(
      ':::details Full\n:::tree\nroot\n:::\nafter\n:::\noutside',
    );
    expect(html).toContain('<p>after</p>\n</details>\n<p>outside</p>');
    expect(html).not.toContain(':::');
  });

  it.each([
    { fence: '```', line: ':::' },
    { fence: '```', line: ':::details X' },
    { fence: '~~~', line: ':::' },
  ])('keeps $line inside a $fence fence as code', ({ fence, line }) => {
    expect(
      block(
        `:::details Full\n${fence}\n${line}\n${fence}\nafter\n:::\noutside`,
      ),
    ).toBe(
      '<details class="md-details"><summary>Full</summary>\n' +
        `<pre><code>${line}\n</code></pre>\n<p>after</p>\n</details>\n<p>outside</p>\n`,
    );
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

  it('keeps a javascript link and a bare URL as text', async () => {
    expect(await render('[x](javascript:alert(1))')).not.toContain('<a');
    expect(await render('see https://e.com')).not.toContain('<a');
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

  it('keeps the diff fence', async () => {
    expect(await render('```diff\n+ a\n- b\n~ c\n same\n```')).toBe(
      '<pre class="md-diff" data-source-line="1"><code>' +
        '<span class="md-diff-add">+ a</span>\n' +
        '<span class="md-diff-del">- b</span>\n' +
        '<span class="md-diff-mod">~ c</span>\n' +
        ' same</code></pre>\n',
    );
    expect(highlightCalls).toEqual([]);
  });

  it('highlights a fence inside details', async () => {
    const html = await render(':::details S\n```ts\nx\n```\n:::');
    expect(html).toContain(
      '<pre data-source-line="2"><code class="language-ts"><span class="tok-keyword">x\n</span></code></pre>',
    );
  });

  it('escapes raw HTML', async () => {
    const html = await render('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('marks blocks, list items and tables with their source line', async () => {
    const html = await render(
      '# T\n\npara\n\n- a\n- b\n\n| a | b |\n| --- | --- |\n| one | two |',
    );
    for (const tag of [
      '<h1 data-anchor="t" data-source-line="1">',
      '<p data-source-line="3">',
      '<ul data-source-line="5">',
      '<li data-source-line="5">',
      '<li data-source-line="6">',
      '<table data-source-line="8">',
    ]) {
      expect(html).toContain(tag);
    }
  });
});
