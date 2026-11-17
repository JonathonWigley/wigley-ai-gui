import type { Clock, RandomHex } from '../../contracts/ambient';
import type { Paths } from '../../contracts/paths';
import {
  type AgentFormStore,
  autoAnsweredRecord,
  formQueries,
  isFinished,
  openRecord,
  type SavedAgentForm,
} from './form-store';

// An AgentFormStore that writes nothing to disk: its forms and answers last
// only as long as the app runs. `paths` compares project folders.
export function createMemoryFormStore(
  clock: Clock,
  randomHex: RandomHex,
  paths: Paths,
): AgentFormStore {
  const records: SavedAgentForm[] = [];
  const stamp = (record: SavedAgentForm) => {
    record.updated = clock.now() / 1000;
  };
  return {
    load: () => Promise.resolve(),
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
    createAutoAnswered: (owner, fingerprint, args, body, toolUseId) => {
      const record = autoAnsweredRecord(
        openRecord(owner, fingerprint, args, body, toolUseId, clock, randomHex),
      );
      records.push(record);
      return record;
    },
    saveBody: (record, body) => {
      if (!isFinished(record)) {
        record.body = body;
        stamp(record);
      }
      return Promise.resolve();
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
    ...formQueries(() => records, paths),
    flushed: () => Promise.resolve(),
  };
}
