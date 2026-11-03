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
    { layout: { working: builder } },
    { layout: { queuedMessage: builder } },
    { layout: { statusLine: builder } },
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
    {
      layout: { composerBar: builder },
      error: 'composerBar is not a layout part; it became the statusLine part',
    },
    { layout: { activity: 'line' }, error: 'activity is not a function' },
    { layout: { working: 'block' }, error: 'working is not a function' },
    {
      layout: { queuedMessage: 'row' },
      error: 'queuedMessage is not a function',
    },
  ])(
    'readChatLayout_Malformed_ThrowsNamingIt ($error)',
    ({ layout, error }) => {
      expect(() => readChatLayout({ default: layout }, 'mine')).toThrow(
        `layout mine: ${error}`,
      );
    },
  );
});
