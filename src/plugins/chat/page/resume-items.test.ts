import { describe, expect, it } from 'vitest';
import type { PastSessionRow } from '../contract';
import {
  type SessionItem,
  selectedAfterChange,
  sessionItems,
  sessionTime,
  withArchived,
} from './resume-items';

const MODIFIED = new Date(2026, 0, 2, 3, 4).getTime();

function row(
  hostSessionId: string,
  title: string,
  archived: boolean,
): PastSessionRow {
  return { hostSessionId, title, modified: MODIFIED, archived };
}

const a = row('a', 'alpha', false);
const b = row('b', 'beta', true);
const c = row('c', 'gamma', false);

const newItem: SessionItem = { kind: 'new', label: 'New session' };

function past(pastRow: PastSessionRow): SessionItem {
  return { kind: 'past', row: pastRow, label: pastRow.title };
}

describe('resume items', () => {
  it('sessionTime_LocalFieldsZeroPadded', () => {
    expect(sessionTime(new Date(2026, 9, 20, 9, 5).getTime())).toBe(
      '2026-10-20 09:05',
    );
  });

  it('sessionItems_NewFirstArchivedOnlyWhenShown', () => {
    const labels = (showArchived: boolean) =>
      sessionItems([a, b], showArchived).map((item) => item.label);
    expect(labels(false)).toEqual(['New session', 'alpha · 2026-01-02 03:04']);
    expect(labels(true)).toEqual([
      'New session',
      'alpha · 2026-01-02 03:04',
      'beta · 2026-01-02 03:04 · archived',
    ]);
  });

  it('withArchived_CopiesWithTheFlagSet', () => {
    const rows = [a, b];
    const changed = withArchived(rows, 'b', false);
    expect(changed[1].archived).toBe(false);
    expect(changed[0]).toEqual(row('a', 'alpha', false));
    expect(rows[1].archived).toBe(true);
    expect(rows).toEqual([row('a', 'alpha', false), row('b', 'beta', true)]);
  });

  it('selectedAfterChange_SameItemNextOrLast', () => {
    const before = [newItem, past(a), past(b), past(c)];
    expect(selectedAfterChange(before, 1, [newItem, past(b), past(c)])).toBe(1);
    expect(selectedAfterChange(before, 3, [newItem, past(a), past(b)])).toBe(2);
    expect(selectedAfterChange(before, 2, before)).toBe(2);
    expect(selectedAfterChange(before, 0, before)).toBe(0);
    expect(selectedAfterChange(before, null, before)).toBe(0);
  });
});
