import { beforeEach, describe, expect, it } from 'vitest';
import { posixPaths } from '../../../../shared/paths/posix-paths';
import type { FormBody } from '../../contract';
import type { RoundOwner, RoundStore } from '../round-store';
import { createMemoryRoundStore } from './memory-round-store';

const MINE: RoundOwner = { sessionId: 's1', projectDir: '/p' };
const NONE: ReadonlySet<string> = new Set();

let nowMs: number;
let hexCount: number;

function store(): RoundStore {
  return createMemoryRoundStore(
    { now: () => nowMs },
    () => (++hexCount).toString(16).padStart(8, '0'),
    posixPaths,
  );
}

function withNote(note: string): FormBody {
  return { note, answers: [], finding_answers: [], notice_comments: [] };
}

beforeEach(() => {
  nowMs = 1_000_000;
  hexCount = 0;
});

describe('createMemoryRoundStore', () => {
  it('create_StampsAnOpenRecordAndFindsIt', () => {
    const subject = store();

    const record = subject.create(MINE, 'f1', { heading: 'h' }, null, 'tu-1');

    expect(record).toMatchObject({
      id: '1000-00000001',
      outcome: 'open',
      body: {},
      session_id: 's1',
      tool_use_id: 'tu-1',
      created: 1000,
      updated: 1000,
    });
    expect(subject.newestFor('f1')).toBe(record);
  });

  it('saveBody_AfterFinish_IsDropped', () => {
    const subject = store();
    const record = subject.create(MINE, 'f1', {}, null, null);
    subject.finish(record, 'submitted', withNote('final'));

    nowMs = 2_000_000;
    subject.saveBody(record, withNote('late'));

    expect(record.body).toEqual(withNote('final'));
    expect(record.updated).toBe(1000);
  });

  it('saveBody_Stamps_SoNewestForPicksTheDraftedRound', () => {
    const subject = store();
    const older = subject.create(MINE, 'f1', {}, null, null);
    nowMs = 2_000_000;
    subject.create(MINE, 'f1', {}, null, null);

    nowMs = 3_000_000;
    subject.saveBody(older, withNote('draft'));

    expect(subject.newestFor('f1')).toBe(older);
    expect(older.updated).toBe(3000);
  });

  it('recentArgs_OrdersByLastWrite', () => {
    const subject = store();
    const first = subject.create(MINE, 'f1', { heading: 'one' }, null, null);
    nowMs = 2_000_000;
    subject.create(MINE, 'f2', { heading: 'two' }, null, null);

    nowMs = 3_000_000;
    subject.finish(first, 'cancelled', withNote('done'));

    expect(subject.recentArgs(5)).toEqual([
      { heading: 'one' },
      { heading: 'two' },
    ]);
  });

  it('markReturned_RemovesFromUnreturnedFinished', () => {
    const subject = store();
    const record = subject.create(MINE, 'f1', {}, null, null);
    subject.finish(record, 'submitted', withNote('final'));
    expect(subject.newestUnreturnedFinished(MINE, NONE)).toBe(record);

    nowMs = 2_000_000;
    subject.markReturned(record);

    expect(subject.newestUnreturnedFinished(MINE, NONE)).toBeNull();
    expect(record.updated).toBe(2000);
  });

  it('prune_KeepsEveryRound', () => {
    const subject = store();
    const record = subject.create(MINE, 'f1', {}, null, null);

    subject.prune();

    expect(subject.newestFor('f1')).toBe(record);
  });
});
