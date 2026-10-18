import { describe, expect, it } from 'vitest';
import { createMarkdownItRenderer } from './markdown-it-renderer';

const markdown = createMarkdownItRenderer();

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

  it('turns a NUL into the replacement character', () => {
    expect(block('x \u00000\u0000 y `c`')).toBe(
      '<p>x �0� y <code>c</code></p>\n',
    );
  });
});

describe('inline markdown', () => {
  it('renders bold as strong', () => {
    expect(block('this is **bold** text')).toContain('<strong>bold</strong>');
  });

  it('nests a code span in bold and keeps bold markers inside code literal', () => {
    expect(block('**a `b` c**')).toBe(
      '<p><strong>a <code>b</code> c</strong></p>\n',
    );
    expect(block('`**x**`')).toBe('<p><code>**x**</code></p>\n');
  });
});

describe('inline()', () => {
  it('renders code and emphasis and escapes HTML, with no paragraph', () => {
    expect(markdown.inline('use `foo` **here** <b>')).toBe(
      'use <code>foo</code> <strong>here</strong> &lt;b&gt;',
    );
  });

  it('leaves block syntax as text', () => {
    expect(markdown.inline('# not a heading\n- not a list')).toBe(
      '# not a heading\n- not a list',
    );
  });

  it('shows a link as text', () => {
    expect(markdown.inline('[x](https://example.com)')).toBe(
      '[x](https://example.com)',
    );
  });
});

describe('lists', () => {
  it('renders an unordered list', () => {
    const html = block('- first item\n- second item');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first item</li>');
    expect(html).toContain('<li>second item</li>');
  });

  it('renders an ordered list', () => {
    const html = block('1. first item\n2. second item');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first item</li>');
    expect(html).toContain('<li>second item</li>');
  });

  it('makes two lists when the marker kind switches', () => {
    const html = block('- bullet one\n1. number one');
    expect(html).toContain('<li>bullet one</li>');
    expect(html).toContain('<li>number one</li>');
    expect(html).toContain('</ul>\n<ol>');
  });

  it('nests an indented list inside its item', () => {
    expect(block('- a\n  - b')).toContain(
      '<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>',
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

  it('renders dashes under prose as a level-two heading, not a table', () => {
    const html = block('A plain heading line\n---');
    expect(html).not.toContain('<table');
    expect(html).toBe('<p class="md-h md-h2">A plain heading line</p>\n');
  });
});

describe('blockquotes', () => {
  it('renders a quoted line as a blockquote without its marker', () => {
    const html = block('> a quoted line');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('a quoted line');
    expect(html).not.toContain('&gt;');
  });

  it('makes adjacent quoted lines one blockquote', () => {
    expect(block('> first line\n> second line')).toBe(
      '<blockquote>\n<p>first line\nsecond line</p>\n</blockquote>\n',
    );
  });
});

describe('tables', () => {
  it('renders the header, body and cells', () => {
    const html = block(
      '| Name | Kind | Note |\n' +
        '| --- | --- | --- |\n' +
        '| alpha | seam | first |\n' +
        '| beta | adapter | second |',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    for (const cell of ['<th>Name</th>', '<th>Kind</th>', '<th>Note</th>']) {
      expect(html).toContain(cell);
    }
    for (const cell of [
      '<td>alpha</td>',
      '<td>adapter</td>',
      '<td>second</td>',
    ]) {
      expect(html).toContain(cell);
    }
    expect(html.split('<tr>').length - 1).toBe(3);
  });

  it('treats outer pipes as optional', () => {
    const withPipes = block('| a | b |\n| --- | --- |\n| one | two |');
    const withoutPipes = block('a | b\n--- | ---\none | two');
    expect(withPipes).toBe(withoutPipes);
    expect(withoutPipes).toContain('<th>a</th>');
    expect(withoutPipes).toContain('<td>two</td>');
  });

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

  it('renders inline code and bold in a cell', () => {
    const html = block(
      '| Identifier | Status |\n| --- | --- |\n| `Backtick_Identifier` | **done** |',
    );
    expect(html).toContain('<td><code>Backtick_Identifier</code></td>');
    expect(html).toContain('<td><strong>done</strong></td>');
  });

  it('escapes a script tag in a cell', () => {
    const html = block(
      '| Payload | Note |\n| --- | --- |\n| <script>alert(1)</script> | bad |',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('pads a short row and drops the cells past the header', () => {
    const html = block(
      '| a | b | c |\n| --- | --- | --- |\n| one |\n| p | q | r | s |',
    );
    expect(html).toContain('<tr>\n<td>one</td>\n<td></td>\n<td></td>\n</tr>');
    expect(html).toContain('<tr>\n<td>p</td>\n<td>q</td>\n<td>r</td>\n</tr>');
    expect(html).not.toContain('>s<');
  });

  it('keeps a pipe line without a delimiter row a paragraph', () => {
    expect(block('Totals | subtotals | were both wrong.')).toBe(
      '<p>Totals | subtotals | were both wrong.</p>\n',
    );
    expect(block('Cost | 5\nand that is the whole of it.')).toBe(
      '<p>Cost | 5\nand that is the whole of it.</p>\n',
    );
  });
});

describe('fences', () => {
  it('renders a fence as pre code', () => {
    expect(block('```\nsome code\n```')).toBe(
      '<pre><code>some code\n</code></pre>\n',
    );
  });

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

  it('keeps a bare closer inside a fence as code', () => {
    expect(block(':::details Full\n```\n:::\n```\nafter\n:::\noutside')).toBe(
      '<details class="md-details"><summary>Full</summary>\n' +
        '<pre><code>:::\n</code></pre>\n<p>after</p>\n</details>\n<p>outside</p>\n',
    );
  });

  it('keeps an opener inside a fence as code', () => {
    expect(
      block(':::details Full\n```\n:::details X\n```\nafter\n:::\noutside'),
    ).toBe(
      '<details class="md-details"><summary>Full</summary>\n' +
        '<pre><code>:::details X\n</code></pre>\n<p>after</p>\n</details>\n<p>outside</p>\n',
    );
  });

  it('keeps a bare closer inside a tilde fence as code', () => {
    expect(block(':::details Full\n~~~\n:::\n~~~\nafter\n:::')).toContain(
      '<pre><code>:::\n</code></pre>\n<p>after</p>\n</details>\n',
    );
  });
});
