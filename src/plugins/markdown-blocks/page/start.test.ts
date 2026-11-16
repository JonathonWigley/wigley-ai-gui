import { describe, expect, it } from 'vitest';
import { startPagePart } from '../../../shared/plugin-part-harness.test-support';
import { markdownBlocksPagePart } from './start';

describe('markdown-blocks page part', () => {
  it('start_AddsTheThreeBlocks_StopRemovesThem', async () => {
    const harness = startPagePart(markdownBlocksPagePart);

    expect(harness.blocks.map((block) => block.name)).toEqual([
      'changes',
      'tree',
      'details',
    ]);

    await harness.stop();

    expect(harness.blocks).toEqual([]);
  });
});
