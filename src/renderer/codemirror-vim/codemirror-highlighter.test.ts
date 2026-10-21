import { describe, expect, it } from 'vitest';
import { createCodeMirrorHighlighter } from './codemirror-highlighter';

const highlighter = createCodeMirrorHighlighter();

describe('highlight()', () => {
  it('marks keywords and numbers', async () => {
    const html = await highlighter.highlight('const a = 1;', 'typescript');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
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
      'tok-string',
    );
  });

  it('highlights a markdown heading', async () => {
    const html = await highlighter.highlight('# Title', 'markdown');
    expect(html).toContain('tok-heading');
    expect(html).toContain('Title');
  });
});
