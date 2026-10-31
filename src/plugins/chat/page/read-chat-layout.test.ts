import { describe, expect, it } from 'vitest';
import { readChatLayout } from './read-chat-layout';

const builder = () => ({ element: {} as HTMLElement });

describe('readChatLayout', () => {
  it.each([
    { layout: {} },
    { layout: { entries: { tool: builder } } },
    { layout: { entries: { tool: undefined }, composer: builder } },
    { layout: { composer: builder, imageViewer: builder } },
    { layout: { activity: builder } },
  ])(
    'readChatLayout_PartsItChanges_ReturnsTheDefaultExport ($layout)',
    ({ layout }) => {
      expect(readChatLayout({ default: layout }, 'mine')).toBe(layout);
    },
  );

  it.each([
    { layout: 3, error: 'the default export is missing or not an object' },
    { layout: { entries: 'cards' }, error: 'entries is not an object' },
    {
      layout: { entries: { tool: 'card' } },
      error: 'entries.tool is not a function',
    },
    {
      layout: { entries: { toast: builder } },
      error: 'entries.toast is not a layout part',
    },
    { layout: { composer: 'panel' }, error: 'composer is not a function' },
    { layout: { compose: builder }, error: 'compose is not a layout part' },
    { layout: { activity: 'line' }, error: 'activity is not a function' },
  ])(
    'readChatLayout_Malformed_ThrowsNamingIt ($error)',
    ({ layout, error }) => {
      expect(() => readChatLayout({ default: layout }, 'mine')).toThrow(
        `layout mine: ${error}`,
      );
    },
  );
});
