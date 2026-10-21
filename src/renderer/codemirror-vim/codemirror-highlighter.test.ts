import { languages } from '@codemirror/language-data';
import { type Tag, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { codeColours } from './code-colours';
import { createCodeMirrorHighlighter } from './codemirror-highlighter';

const highlighter = createCodeMirrorHighlighter();

// The class the code colour style gives text carrying `tag`.
function classFor(tag: Tag): string {
  const classes = codeColours.style([tag]);
  if (classes === null) {
    throw new Error('The code colour style styles no such tag');
  }
  return classes;
}

describe('highlight()', () => {
  it('marks keywords and numbers with the code colour classes', async () => {
    const html = await highlighter.highlight('const a = 1;', 'typescript');
    expect(html).toContain(
      `<span class="${classFor(tags.definitionKeyword)}">const</span>`,
    );
    expect(html).toContain(`<span class="${classFor(tags.number)}">1</span>`);
    expect(html).not.toContain('tok-');
    expect(await highlighter.highlight('const a = 1;', 'ts')).toBe(html);
  });

  it('escapes the code', async () => {
    const html = await highlighter.highlight('a < b && "<x>"', 'js');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;&amp;');
    expect(html).not.toContain('<x>');
  });

  it('keeps line breaks', async () => {
    expect(await highlighter.highlight('a\nb', 'js')).toContain('\n');
  });

  it('returns null for an unknown language', async () => {
    expect(await highlighter.highlight('x', 'nosuchlang')).toBeNull();
  });

  it('highlights a stream language', async () => {
    expect(await highlighter.highlight('key = "v"', 'toml')).toContain(
      `<span class="${classFor(tags.string)}">"v"</span>`,
    );
  });

  it('highlights a markdown heading', async () => {
    const html = await highlighter.highlight('# Title', 'markdown');
    expect(html).toContain(classFor(tags.heading1));
    expect(html).toContain('Title');
  });

  it('highlights a fence inside markdown in its language', async () => {
    const html = await highlighter.highlight(
      '```python\ndef f(): pass\n```',
      'markdown',
    );
    expect(html).toContain(
      `<span class="${classFor(tags.definitionKeyword)}">def</span>`,
    );
  });

  // Vitest fails the run on an unhandled rejection, so a leaked load fails
  // here. The stub is assigned, not spied: a spy handles the promises it
  // returns.
  it('renders a fence plain when its language fails to load', async () => {
    const haskell = languages.find(({ name }) => name === 'Haskell');
    if (!haskell) {
      throw new Error('language-data lists no Haskell to fail the load of');
    }
    const load = haskell.load;
    let loads = 0;
    haskell.load = () => {
      loads++;
      return Promise.reject(new Error('chunk failed'));
    };
    try {
      const html = await highlighter.highlight(
        '```haskell\nmain = 1\n```',
        'markdown',
      );
      expect(loads).toBeGreaterThan(0);
      expect(html).toContain('\nmain = 1\n');
    } finally {
      haskell.load = load;
    }
  });
});
