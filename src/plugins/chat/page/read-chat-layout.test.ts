import { describe, expect, it } from 'vitest';
import { readChatLayout } from './read-chat-layout';

const builder = () => ({ element: {} as HTMLElement });

function entriesWithout(missing: string | null): Record<string, unknown> {
  const kinds = [
    'user',
    'assistant',
    'thinking',
    'tool',
    'permission',
    'result',
    'notice',
    'raw',
  ].filter((kind) => kind !== missing);
  return Object.fromEntries(kinds.map((kind) => [kind, builder]));
}

describe('readChatLayout', () => {
  it('readChatLayout_MissingKind_ThrowsNamingIt', () => {
    const module = { default: { entries: entriesWithout('tool') } };

    expect(() => readChatLayout(module, 'mine')).toThrow(
      'layout mine: entries.tool is missing or not a function',
    );
  });

  it('readChatLayout_NotAnObject_Throws', () => {
    expect(() => readChatLayout({ default: 3 }, 'mine')).toThrow(
      'layout mine: the default export is missing or not an object',
    );
  });

  it('readChatLayout_EveryKind_ReturnsTheDefaultExport', () => {
    const layout = { entries: entriesWithout(null) };

    expect(readChatLayout({ default: layout }, 'mine')).toBe(layout);
  });
});
