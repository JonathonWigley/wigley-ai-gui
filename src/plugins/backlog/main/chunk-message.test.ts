import { describe, expect, it } from 'vitest';
import { type ChunkItem, chunkMessage } from './chunk-message';

const FILE = '/r/docs/features/followups.md';

const ITEM_A: ChunkItem = {
  title: 'A',
  oneLine: 'gist a',
  body: 'Body a.',
  path: FILE,
  line: 3,
};

const ITEM_B: ChunkItem = {
  title: 'B',
  oneLine: '',
  body: 'Body b.',
  path: FILE,
  line: 9,
};

describe('chunkMessage', () => {
  it('chunkMessage_TwoItems_BriefThenEachBlock', () => {
    expect(chunkMessage('Brief.', [ITEM_A, ITEM_B])).toBe(
      'Brief.\n\n## A\n\ngist a\n\nBody a.\n\nFrom /r/docs/features/followups.md:3\n\n## B\n\nBody b.\n\nFrom /r/docs/features/followups.md:9',
    );
  });

  it('chunkMessage_BlankBrief_LeftOut', () => {
    expect(chunkMessage(' \n ', [{ ...ITEM_A, body: '\nBody a.\n' }])).toBe(
      '## A\n\ngist a\n\nBody a.\n\nFrom /r/docs/features/followups.md:3',
    );
  });
});
