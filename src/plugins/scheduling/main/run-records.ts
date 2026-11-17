import type { HostedRun } from '../../../contracts/session-host';
import { isJsonObject, isStringArray } from '../../../shared/json';
import type { AdoptRequest } from '../../chat/contract';
import type { RunHistoryEntry } from '../contract';

// What a `PendingSpawn.record` holds for a scheduled run.
export interface ScheduledRunRecord {
  taskId: string;
  occurrence: number;
  adopt: AdoptRequest;
}

// The record, or null when `record` is not a scheduled run's.
export function readRunRecord(record: unknown): ScheduledRunRecord | null {
  const isRunRecord =
    isJsonObject(record) &&
    typeof record.taskId === 'string' &&
    typeof record.occurrence === 'number' &&
    isAdoptRequest(record.adopt);
  return isRunRecord ? (record as unknown as ScheduledRunRecord) : null;
}

// `rowId` is the sessionId `chat.adopt` resolved to; null for a skipped or failed run.
export function runEntry(
  run: HostedRun,
  record: ScheduledRunRecord,
  rowId: string | null,
): RunHistoryEntry {
  const base = {
    taskId: record.taskId,
    occurrence: record.occurrence,
    at: run.startedAt,
  };
  if (run.skipped) {
    return notStarted(base, 'skipped', null);
  }
  const error = run.exit?.error ?? null;
  if (error !== null) {
    return notStarted(base, 'failed', spawnFailure(record, error));
  }
  return {
    ...base,
    outcome: 'running',
    reason: null,
    rowId,
    processId: record.adopt.processId,
    viewed: false,
  };
}

function notStarted(
  base: Pick<RunHistoryEntry, 'taskId' | 'occurrence' | 'at'>,
  outcome: 'skipped' | 'failed',
  reason: string | null,
): RunHistoryEntry {
  return {
    ...base,
    outcome,
    reason,
    rowId: null,
    processId: null,
    viewed: true,
  };
}

// The reason of a spawn the host could not make; `ENOENT` names a missing folder or agent command.
function spawnFailure(record: ScheduledRunRecord, error: string): string {
  const where = `could not start the agent in ${record.adopt.projectDir}`;
  return error.includes('ENOENT')
    ? `${where}: the folder or the agent command is missing (${error})`
    : `${where}: ${error}`;
}

function isAdoptRequest(value: unknown): value is AdoptRequest {
  if (!isJsonObject(value)) {
    return false;
  }
  const hasStrings = [
    'hostSessionId',
    'processId',
    'rowId',
    'projectDir',
    'profile',
  ].every((key) => typeof value[key] === 'string');
  const hasFlags =
    typeof value.headless === 'boolean' &&
    typeof value.unattended === 'boolean';
  const hasOwner = value.owner === null || typeof value.owner === 'string';
  return (
    hasStrings &&
    hasFlags &&
    hasOwner &&
    isStringArray(value.instructions) &&
    isStringRecord(value.controls) &&
    isJsonObject(value.titles)
  );
}

function isStringRecord(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    Object.values(value).every((field) => typeof field === 'string')
  );
}
