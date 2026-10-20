import type { Clock, RandomHex } from '../../../../contracts/ambient';
import {
  isFinished,
  openRecord,
  type RoundStore,
  roundQueries,
  type SavedRound,
} from '../round-store';

// A RoundStore that writes nothing to disk: the preview's rounds and answers
// last only as long as the app runs.
export function createMemoryRoundStore(
  clock: Clock,
  randomHex: RandomHex,
): RoundStore {
  const records: SavedRound[] = [];
  const stamp = (record: SavedRound) => {
    record.updated = clock.now() / 1000;
  };
  return {
    create: (owner, fingerprint, args, body, toolUseId) => {
      const record = openRecord(
        owner,
        fingerprint,
        args,
        body,
        toolUseId,
        clock,
        randomHex,
      );
      records.push(record);
      return record;
    },
    saveBody: (record, body) => {
      if (isFinished(record)) {
        return;
      }
      record.body = body;
      stamp(record);
    },
    finish: (record, outcome, body) => {
      record.body = body;
      record.outcome = outcome;
      stamp(record);
    },
    markReturned: (record) => {
      record.returned = true;
      stamp(record);
    },
    ...roundQueries(() => records),
    prune: () => undefined,
  };
}
