import { describe, expect, it } from 'vitest';
import { toolSummary } from './tool-summary';

describe('toolSummary', () => {
  it('toolSummary_Bash_FirstLineOfCommand', () => {
    expect(toolSummary('Bash', { command: 'ls -la\necho' })).toBe('ls -la');
  });

  it('toolSummary_FileTools_FilePath', () => {
    for (const name of ['Read', 'Edit', 'Write', 'MultiEdit']) {
      expect(toolSummary(name, { file_path: '/p/a.txt', limit: 1 })).toBe(
        '/p/a.txt',
      );
    }
  });

  it('toolSummary_UnknownTool_FirstStringField', () => {
    expect(
      toolSummary('mcp__x__y', { count: 2, heading: 'h', other: 'o' }),
    ).toBe('h');
    expect(toolSummary('Read', { limit: 1, note: 'n' })).toBe('n');
    expect(toolSummary('mcp__x__y', { count: 2 })).toBe('');
  });

  it('toolSummary_Long_TruncatedTo80', () => {
    const summary = toolSummary('Bash', { command: 'x'.repeat(100) });

    expect(summary).toHaveLength(80);
    expect(summary).toBe(`${'x'.repeat(79)}…`);
  });
});
