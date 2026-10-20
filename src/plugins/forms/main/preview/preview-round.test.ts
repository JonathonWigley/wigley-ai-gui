import { describe, expect, it } from 'vitest';
import { parseRound } from '../round';
import { PREVIEW_ROUND_ARGS } from './preview-round';

describe('PREVIEW_ROUND_ARGS', () => {
  it('previewRoundArgs_Parse_HoldEveryCardKind', () => {
    const round = parseRound(PREVIEW_ROUND_ARGS);

    expect(round.notices.map((notice) => notice.badge)).toContain('Decided');
    expect(round.findings.map((finding) => finding.origin)).toEqual(
      expect.arrayContaining(['caused', 'design', 'nit']),
    );
    expect(round.questions.length).toBeGreaterThan(0);
  });
});
