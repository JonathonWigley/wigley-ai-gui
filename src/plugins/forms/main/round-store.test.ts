import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FormBody } from '../contract';
import {
  createRoundStore,
  RETENTION_SECONDS,
  type RoundOwner,
  type RoundStore,
} from './round-store';

const MINE: RoundOwner = { sessionId: 's1', projectDir: '/p' };
const ARGS = { heading: 'h' };
const NONE: ReadonlySet<string> = new Set();

let root: string;
let roundsDir: string;
let nowMs: number;
let hexCount: number;
let logLines: string[];

function storeIn(dir: string): RoundStore {
  return createRoundStore({
    roundsDir: dir,
    clock: { now: () => nowMs },
    randomHex: () => (++hexCount).toString(16).padStart(8, '0'),
    log: (source, message) => logLines.push(`[${source}] ${message}`),
  });
}

function withNote(note: string): FormBody {
  return { note, answers: [], finding_answers: [], notice_comments: [] };
}

function roundFiles(): string[] {
  return readdirSync(roundsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wigley-round-store-'));
  roundsDir = path.join(root, 'rounds');
  nowMs = 1_000_000;
  hexCount = 0;
  logLines = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('RoundStore', () => {
  it('writes one file per round, named by its <epoch seconds>-<8 hex> id', () => {
    const record = storeIn(roundsDir).create(
      MINE,
      'fp',
      ARGS,
      withNote('n'),
      null,
    );

    expect(record.id).toBe('1000-00000001');
    expect(roundFiles()).toEqual(['1000-00000001.json']);
  });

  it('writes the saved-round fields retro reads', () => {
    const record = storeIn(roundsDir).create(
      MINE,
      'fp',
      ARGS,
      withNote('n'),
      'toolu_1',
    );

    const saved = JSON.parse(
      readFileSync(path.join(roundsDir, `${record.id}.json`), 'utf8'),
    );

    expect(saved).toEqual({
      id: '1000-00000001',
      fingerprint: 'fp',
      args: { heading: 'h' },
      body: {
        note: 'n',
        answers: [],
        finding_answers: [],
        notice_comments: [],
      },
      outcome: 'open',
      returned: false,
      session_id: 's1',
      project_dir: '/p',
      tool_use_id: 'toolu_1',
      created: 1000,
      updated: 1000,
    });
  });

  it('reads a created round back equal, open and unreturned', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, withNote('n'), null);

    expect(store.newestFor('fp')).toEqual(record);
    expect(record.outcome).toBe('open');
    expect(record.returned).toBe(false);
  });

  it('writes an empty body for a round opened with no saved answers', () => {
    const store = storeIn(roundsDir);
    store.create(MINE, 'fp', ARGS, null, null);

    expect(store.newestFor('fp')?.body).toEqual({});
  });

  it('rewrites the file on a draft and on the finish', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);

    store.saveBody(record, withNote('half'));
    expect(store.newestFor('fp')?.body).toEqual(withNote('half'));

    store.finish(record, 'submitted', withNote('done'));
    expect(store.newestFor('fp')).toMatchObject({
      outcome: 'submitted',
      body: withNote('done'),
    });
  });

  it('keeps the finished body when a draft arrives after the finish', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote('done'));

    store.saveBody(record, withNote('late draft'));

    expect(store.newestFor('fp')).toMatchObject({
      outcome: 'submitted',
      body: withNote('done'),
    });
  });

  it('finds the round with this fingerprint updated last', () => {
    const store = storeIn(roundsDir);
    const older = store.create(MINE, 'fp', ARGS, withNote('older'), null);
    nowMs = 2_000_000;
    store.create(MINE, 'fp', ARGS, withNote('newer'), null);
    nowMs = 3_000_000;
    store.saveBody(older, withNote('touched last'));

    expect(store.newestFor('fp')?.body).toEqual(withNote('touched last'));
  });

  it('recentArgs_NewestFirst_Limited', () => {
    const store = storeIn(roundsDir);
    store.create(MINE, 'fp-1', { heading: 'oldest' }, null, null);
    nowMs = 2_000_000;
    store.create(MINE, 'fp-2', { heading: 'middle' }, null, null);
    nowMs = 3_000_000;
    store.create(MINE, 'fp-3', { heading: 'newest' }, null, null);

    expect(store.recentArgs(2)).toEqual([
      { heading: 'newest' },
      { heading: 'middle' },
    ]);
  });

  it('recentArgs_SkipsUnreadableFile', () => {
    const store = storeIn(roundsDir);
    store.create(MINE, 'fp', ARGS, null, null);
    writeFileSync(path.join(roundsDir, 'broken.json'), '{not json', 'utf8');

    expect(store.recentArgs(5)).toEqual([ARGS]);
  });

  it('recentArgs_OneRecordPerFingerprint', () => {
    const store = storeIn(roundsDir);
    store.create(MINE, 'fp', { heading: 'first send' }, null, null);
    nowMs = 2_000_000;
    store.create(MINE, 'other', { heading: 'other' }, null, null);
    nowMs = 3_000_000;
    store.create(MINE, 'fp', { heading: 'second send' }, null, null);

    expect(store.recentArgs(5)).toEqual([
      { heading: 'second send' },
      { heading: 'other' },
    ]);
  });

  it('finds a finished round as unreturned until it is marked returned', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();

    store.finish(record, 'cancelled', withNote(''));
    expect(store.newestUnreturnedFinished(MINE, NONE)?.id).toBe(record.id);

    store.markReturned(record);
    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();
  });

  it('passes over an excluded round to the older one behind it', () => {
    const store = storeIn(roundsDir);
    const older = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(older, 'submitted', withNote(''));
    nowMs = 2_000_000;
    const newer = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(newer, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(MINE, NONE)?.id).toBe(newer.id);
    expect(store.newestUnreturnedFinished(MINE, new Set([newer.id]))?.id).toBe(
      older.id,
    );
  });

  it("never finds another session's round as this session's", () => {
    const store = storeIn(roundsDir);
    const theirs = store.create(
      { sessionId: 's2', projectDir: '/p' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(theirs, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(MINE, NONE)).toBeNull();
  });

  it('lets the project folder decide when there is no session id', () => {
    const store = storeIn(roundsDir);
    const mine = store.create(
      { sessionId: null, projectDir: '/p' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(mine, 'submitted', withNote(''));
    const theirs = store.create(
      { sessionId: null, projectDir: '/q' },
      'fp',
      ARGS,
      null,
      null,
    );
    store.finish(theirs, 'submitted', withNote(''));

    expect(
      store.newestUnreturnedFinished(
        { sessionId: null, projectDir: '/p' },
        NONE,
      )?.id,
    ).toBe(mine.id);
  });

  it('finds nothing as mine with neither a session id nor a project folder, yet still pre-fills', () => {
    const nobody: RoundOwner = { sessionId: null, projectDir: null };
    const store = storeIn(roundsDir);
    const record = store.create(nobody, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote(''));

    expect(store.newestUnreturnedFinished(nobody, NONE)).toBeNull();
    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('prunes only files last written before the retention window', () => {
    nowMs = 2_000_000_000_000;
    const store = storeIn(roundsDir);
    const old = store.create(MINE, 'old', ARGS, null, null);
    const recent = store.create(MINE, 'recent', ARGS, null, null);
    const nowSeconds = nowMs / 1000;
    const staleSeconds = nowSeconds - RETENTION_SECONDS - 60;
    utimesSync(
      path.join(roundsDir, `${old.id}.json`),
      staleSeconds,
      staleSeconds,
    );
    utimesSync(
      path.join(roundsDir, `${recent.id}.json`),
      nowSeconds,
      nowSeconds,
    );

    store.prune();

    expect(roundFiles()).toEqual([`${recent.id}.json`]);
  });

  it('retains saved rounds for at least the 90 days retro backfills', () => {
    // retro (the marketplace's scripts/retro, ledger.STALE_DAYS) backfills 90
    // days and reads these files, so pruning sooner would starve it.
    expect(RETENTION_SECONDS).toBeGreaterThanOrEqual(90 * 24 * 60 * 60);
  });

  it('prunes a temp file a crash left, by the same age rule', () => {
    nowMs = 2_000_000_000_000;
    const store = storeIn(roundsDir);
    store.create(MINE, 'fp', ARGS, null, null);
    const nowSeconds = nowMs / 1000;
    const staleSeconds = nowSeconds - RETENTION_SECONDS - 60;
    const staleTemp = path.join(roundsDir, 'stale.json.tmp');
    const freshTemp = path.join(roundsDir, 'fresh.json.tmp');
    writeFileSync(staleTemp, '{', 'utf8');
    writeFileSync(freshTemp, '{', 'utf8');
    utimesSync(staleTemp, staleSeconds, staleSeconds);
    utimesSync(freshTemp, nowSeconds, nowSeconds);

    store.prune();

    expect(readdirSync(roundsDir).filter((n) => n.endsWith('.tmp'))).toEqual([
      'fresh.json.tmp',
    ]);
  });

  it('skips a corrupt file and a file that is not an object', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    writeFileSync(path.join(roundsDir, 'broken.json'), '{not json', 'utf8');
    writeFileSync(path.join(roundsDir, 'list.json'), '[1, 2]', 'utf8');

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('never reads a leftover temp file as a round', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    const leftover = { ...record, id: 'leftover', updated: 9_999_999 };
    writeFileSync(
      path.join(roundsDir, 'leftover.json.tmp'),
      JSON.stringify(leftover),
      'utf8',
    );

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('loads a file holding a field this version does not know', () => {
    const store = storeIn(roundsDir);
    const record = store.create(MINE, 'fp', ARGS, null, null);
    const filePath = path.join(roundsDir, `${record.id}.json`);
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    writeFileSync(
      filePath,
      JSON.stringify({ ...data, added_later: true }),
      'utf8',
    );

    expect(store.newestFor('fp')?.id).toBe(record.id);
  });

  it('loads a file the Python forms server wrote', () => {
    mkdirSync(roundsDir, { recursive: true });
    writeFileSync(
      path.join(roundsDir, '1700000000-0a1b2c3d.json'),
      '{"id": "1700000000-0a1b2c3d", "fingerprint": "fp-python", ' +
        '"args": {"heading": "h"}, "body": {"note": "caf\\u00e9", ' +
        '"answers": [{"index": 1, "choice": 2, "not_applicable": false, ' +
        '"what": "", "why": ""}]}, "outcome": "submitted", "returned": false, ' +
        '"session_id": "s1", "project_dir": "/p", "tool_use_id": null, ' +
        '"created": 1700000000.25, "updated": 1700000001.5}',
      'utf8',
    );

    expect(
      storeIn(roundsDir).newestUnreturnedFinished(MINE, NONE),
    ).toMatchObject({
      id: '1700000000-0a1b2c3d',
      fingerprint: 'fp-python',
      outcome: 'submitted',
      created: 1700000000.25,
      body: { note: 'café' },
    });
  });

  it('logs and throws nothing when the folder cannot be written', () => {
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'a file where the folder should be', 'utf8');
    const store = storeIn(path.join(blocker, 'rounds'));

    const record = store.create(MINE, 'fp', ARGS, null, null);
    store.finish(record, 'submitted', withNote(''));

    expect(logLines.some((line) => line.includes('could not save round'))).toBe(
      true,
    );
    expect(store.newestFor('fp')).toBeNull();
  });

  it("throws a draft's failed write with the disk's reason", () => {
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'a file where the folder should be', 'utf8');
    const store = storeIn(path.join(blocker, 'rounds'));
    const record = store.create(MINE, 'fp', ARGS, null, null);

    expect(() => store.saveBody(record, withNote('half'))).toThrow(
      `could not save round ${record.id}: `,
    );
  });
});
