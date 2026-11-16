import { describe, expect, it } from 'vitest';
import type { CodeHighlighter } from '../../../contracts/highlight';
import { createMarkdownItRenderer } from '../../../renderer/markdown-it/markdown-it-renderer';
import { changesBlock, treeBlock } from './change-blocks';
import { detailsBlock } from './details-block';

// Knows only `ts`, which it wraps whole in a keyword span.
const highlighter: CodeHighlighter = {
  highlight: (code, language) => {
    const html =
      language === 'ts' ? `<span class="tok-keyword">${code}</span>` : null;
    return Promise.resolve(html);
  },
};

// The real adapter, whose helper markers and in-place body parse make each
// block's bytes.
const markdown = createMarkdownItRenderer(highlighter);
markdown.addBlock(changesBlock);
markdown.addBlock(treeBlock);
markdown.addBlock(detailsBlock);

// The marks `data-md-lines` carries are pinned once, in `cursor block marks`;
// every other row compares the markup without them.
function withoutLineMarks(html: string): string {
  return html.replace(/ data-md-lines="[^"]*"/g, '');
}

function block(text: string): string {
  return withoutLineMarks(markdown.block(text));
}

describe('cursor block marks', () => {
  it('marks each block once, from opener to the line after the closer', () => {
    const html = markdown.block(
      ':::details S\nbody\n\n- item\n:::\n\n:::changes\n+ a\n:::\n\n:::tree\nroot\n  child\n:::',
    );
    expect(html.match(/<[^>]*data-md-lines="[^"]*"[^>]*>/g) ?? []).toEqual([
      '<details class="md-details" data-md-lines="0,5">',
      '<ul class="md-changes" data-md-lines="6,9">',
      '<ul class="md-tree" data-md-lines="10,14">',
    ]);
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

  it('opens with a header, which it ignores', () => {
    expect(block(':::changes foo\n+ a\n:::')).toBe(
      '<ul class="md-changes">' +
        '<li class="md-change added"><span class="md-pill">added</span><span class="md-change-text">a</span></li>' +
        '</ul>\n',
    );
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
  it('highlights a fence inside details', async () => {
    const html = await markdown.document(':::details S\n```ts\nx\n```\n:::');
    expect(html).toContain(
      '<pre data-source-line="2"><code class="language-ts"><span class="tok-keyword">x\n</span></code></pre>',
    );
  });

  it('marks each block with its source line', async () => {
    const html = await markdown.document(
      '# T\n\npara\n\n- a\n- b\n\n| a | b |\n| --- | --- |\n| one | two |\n\n:::details S\nbody\n:::\n\n:::changes\n+ a\n:::\n\n:::tree\nroot\n:::',
    );
    for (const tag of [
      '<details class="md-details" data-source-line="12">',
      '<ul class="md-changes" data-source-line="16">',
      '<ul class="md-tree" data-source-line="20">',
    ]) {
      expect(html).toContain(tag);
    }
  });
});
