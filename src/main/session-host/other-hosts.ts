import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Log } from '../../contracts/log';
import type { HostedProcessInfo } from '../../contracts/session-host';
import {
  hostRecordProtocol,
  SESSION_HOST_PROTOCOL,
  type SessionHostRecord,
} from '../../contracts/session-host-protocol';
import {
  HOST_REPLY_LIMIT_MS,
  type HostAnswer,
  type HostLink,
  LOG_SOURCE,
} from './host-link';

export interface OtherHostsDeps {
  folder: string;
  open(channel: string): Promise<HostAnswer>;
  log: Log;
}

// The hosts of other protocols, found through their record files in the host folder.
export interface OtherHosts {
  // Sends `drain` to each older host that answers, once per record for the life of this object.
  drainOlder(): Promise<void>;
  // The processes of every other host that answers, older and newer, lowest protocol first.
  list(): Promise<HostedProcessInfo[]>;
}

interface OtherRecord {
  file: string;
  protocol: number;
  channel: string;
}

async function hostFolderNames(folder: string, log: Log): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error) {
    // The first host of this folder has not made it yet.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(LOG_SOURCE, `cannot read ${folder}: ${(error as Error).message}`);
    }
    return [];
  }
}

async function readRecordChannel(
  file: string,
  log: Log,
): Promise<string | null> {
  try {
    const record = JSON.parse(
      await readFile(file, 'utf8'),
    ) as SessionHostRecord;
    if (typeof record.channel === 'string') {
      return record.channel;
    }
    log(LOG_SOURCE, `skipped ${file}: it names no channel`);
  } catch (error) {
    log(LOG_SOURCE, `skipped ${file}: ${(error as Error).message}`);
  }
  return null;
}

async function readOtherRecords(
  folder: string,
  log: Log,
): Promise<OtherRecord[]> {
  const others: { file: string; protocol: number }[] = [];
  for (const name of await hostFolderNames(folder, log)) {
    const protocol = hostRecordProtocol(name);
    if (protocol !== null && protocol !== SESSION_HOST_PROTOCOL) {
      others.push({ file: path.join(folder, name), protocol });
    }
  }
  others.sort((a, b) => a.protocol - b.protocol);
  const records = await Promise.all(
    others.map(async (other) => {
      const channel = await readRecordChannel(other.file, log);
      return channel === null ? null : { ...other, channel };
    }),
  );
  return records.filter((record) => record !== null);
}

async function deleteStaleRecord(file: string, log: Log) {
  try {
    await rm(file, { force: true });
    log(LOG_SOURCE, `deleted ${file}: its channel refused the connection`);
  } catch (error) {
    log(LOG_SOURCE, `cannot delete ${file}: ${(error as Error).message}`);
  }
}

export function createOtherHosts(deps: OtherHostsDeps): OtherHosts {
  const drained = new Set<string>();
  const loggedNewer = new Set<string>();

  const linkOf = async (record: OtherRecord): Promise<HostLink | null> => {
    const answer = await deps.open(record.channel);
    if (answer.kind === 'unreachable') {
      await deleteStaleRecord(record.file, deps.log);
    }
    return answer.kind === 'answered' ? answer.link : null;
  };

  const drain = async (record: OtherRecord) => {
    const link = await linkOf(record);
    if (link === null) {
      return;
    }
    if (!drained.has(record.file)) {
      drained.add(record.file);
      link.send({ type: 'drain' });
    }
    link.end();
  };

  const listOf = async (record: OtherRecord): Promise<HostedProcessInfo[]> => {
    const link = await linkOf(record);
    if (link === null) {
      return [];
    }
    const reply = await link.request(
      (requestId) => ({ type: 'list', requestId }),
      HOST_REPLY_LIMIT_MS,
    );
    link.end();
    if (reply?.type !== 'list') {
      return [];
    }
    return reply.processes.map(({ id, startedAt, running }) => ({
      id,
      startedAt,
      running,
      current: false,
    }));
  };

  return {
    async drainOlder() {
      const records = await readOtherRecords(deps.folder, deps.log);
      const older: OtherRecord[] = [];
      for (const record of records) {
        if (record.protocol < SESSION_HOST_PROTOCOL) {
          if (!drained.has(record.file)) {
            older.push(record);
          }
        } else if (!loggedNewer.has(record.file)) {
          loggedNewer.add(record.file);
          deps.log(
            LOG_SOURCE,
            `a newer host's record ${record.file}: its processes keep running`,
          );
        }
      }
      await Promise.all(older.map(drain));
    },
    async list() {
      const records = await readOtherRecords(deps.folder, deps.log);
      return (await Promise.all(records.map(listOf))).flat();
    },
  };
}
