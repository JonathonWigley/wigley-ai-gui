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

  it('previewRoundArgs_Parse_HoldGroupedChoicesAndReasons', () => {
    const { findings } = parseRound(PREVIEW_ROUND_ARGS);

    const groupsAChoiceOutsideFixNow = findings.some((finding) =>
      finding.choices.some((choice) => choice.action !== 'fix_now'),
    );
    const showsAFollowUpReason = findings.some(
      (finding) => finding.actionReasons.follow_up !== undefined,
    );
    const recommendsABareLeaveIt = findings.some(
      (finding) =>
        finding.actionReasons.leave_it !== undefined &&
        finding.recommend === null,
    );
    expect(groupsAChoiceOutsideFixNow).toBe(true);
    expect(showsAFollowUpReason).toBe(true);
    expect(recommendsABareLeaveIt).toBe(true);
  });
});
