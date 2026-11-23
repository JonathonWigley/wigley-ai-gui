import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import type { WorkFile } from './store';

// The worker rows `openJobRow` can reopen, newest first, in plugin data.
export const JOB_ROWS_FILE = 'job-rows.json';
const KEPT_JOB_ROWS = 20;

// A worker job's closed row, as `chat.sessionClosed` gave it: enough for `chat.resume` to reopen it.
export interface JobRowRecord {
  rowId: string;
  hostSessionId: string;
  projectDir: string;
  profile: string;
  title: string;
}

const RECORD_FIELDS = [
  'rowId',
  'hostSessionId',
  'projectDir',
  'profile',
  'title',
] as const;

function parseJobRows(text: string): JobRowRecord[] {
  const parsed: unknown = JSON.parse(text);
  const isRecord = (value: unknown) => {
    if (!isJsonObject(value)) {
      return false;
    }
    const record = value;
    return RECORD_FIELDS.every((field) => typeof record[field] === 'string');
  };
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error('job-rows.json is not a list of job rows');
  }
  return (parsed as JobRowRecord[]).map((record) => ({
    rowId: record.rowId,
    hostSessionId: record.hostSessionId,
    projectDir: record.projectDir,
    profile: record.profile,
    title: record.title,
  }));
}

// `records` with `record` at the front, replacing the one for its row, cut to `KEPT_JOB_ROWS`.
function withRecord(
  records: readonly JobRowRecord[],
  record: JobRowRecord,
): JobRowRecord[] {
  return [
    record,
    ...records.filter((kept) => kept.rowId !== record.rowId),
  ].slice(0, KEPT_JOB_ROWS);
}

// `job-rows.json`, held in memory: the 20 newest records, newest first, a repeat row replacing its record. `load`
// reads it once: a missing file is no records; one it cannot read or parse logs `job-rows.json not read: …`, starts
// empty and is never written this run. A record kept before the load ends stays ahead of every saved one. `keep`
// writes the whole list on one chain, a failed write logging `job-rows.json not written: …`; `settled` waits for the
// load and every write.
export interface JobRows {
  load(): Promise<void>;
  find(rowId: string): JobRowRecord | undefined;
  keep(record: JobRowRecord): void;
  settled(): Promise<void>;
}

export function createJobRows(data: Files, log: PluginLog): JobRows {
  let records: JobRowRecord[] = [];
  let isWritable = true;
  let loading: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();

  const write = () => {
    writes = writes.then(async () => {
      if (!isWritable) {
        return;
      }
      try {
        await data.write(JOB_ROWS_FILE, JSON.stringify(records, null, 2));
      } catch (error) {
        log(`job-rows.json not written: ${errorText(error)}`);
      }
    });
  };

  const read = async () => {
    try {
      const text = await readIfPresent(data, JOB_ROWS_FILE);
      const saved = text === null ? [] : parseJobRows(text);
      // A record kept before the read finished is newer than every saved one.
      const keptEarly = records;
      records = saved;
      for (const record of [...keptEarly].reverse()) {
        records = withRecord(records, record);
      }
    } catch (error) {
      log(`job-rows.json not read: ${errorText(error)}`);
      isWritable = false;
    }
  };

  return {
    load() {
      if (loading === null) {
        loading = read();
        writes = loading;
      }
      return loading;
    },
    find: (rowId) => records.find((record) => record.rowId === rowId),
    keep(record) {
      records = withRecord(records, record);
      write();
    },
    settled: () => Promise.all([loading, writes]).then(() => undefined),
  };
}

// `file` with `job.last.rowId` nulled when no kept record names it, so the views' Show transcript follows what can
// reopen; the same object otherwise.
export function withKeptLastRow(file: WorkFile, rows: JobRows): WorkFile {
  const { last } = file.job;
  if (
    last === null ||
    last.rowId === null ||
    rows.find(last.rowId) !== undefined
  ) {
    return file;
  }
  return { ...file, job: { ...file.job, last: { ...last, rowId: null } } };
}
