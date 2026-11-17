import { describe, expect, it } from 'vitest';
import type { Finding, Notice } from '../../contract';
import { BUILT_IN_KINDS } from '../kinds/formats';
import { parseRound } from '../round';
import { PREVIEW_ROUND_ARGS } from './preview-round';

describe('PREVIEW_ROUND_ARGS', () => {
  it('parses, and holds every card kind, every notice badge, grouped choices and action reasons', () => {
    const round = parseRound(BUILT_IN_KINDS, PREVIEW_ROUND_ARGS);
    const findings = round.items.finding as Finding[];
    const notices = round.items.notice as Notice[];

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
    expect(notices.map((notice) => notice.badge)).toEqual(
      expect.arrayContaining(['Applied', 'Dispatched', 'Decided']),
    );
    expect(findings.map((finding) => finding.origin)).toEqual(
      expect.arrayContaining(['caused', 'design', 'nit']),
    );
    expect(round.items.question.length).toBeGreaterThan(0);
    expect(groupsAChoiceOutsideFixNow).toBe(true);
    expect(showsAFollowUpReason).toBe(true);
    expect(recommendsABareLeaveIt).toBe(true);
  });
});
