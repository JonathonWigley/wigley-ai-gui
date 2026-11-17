import { type Files, isMissingFile } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';

// The env var naming the calls folder a relay in offline mode appends to.
export const OFFLINE_ENV = 'WIGLEY_FORMS_OFFLINE';

// The calls folder's name inside the app's endpoint folder.
export const OFFLINE_CALLS_FOLDER = 'offline-calls';

// One line of a calls file: a call the relay answered alone while the app was
// closed. `replay` is the offline table entry's, false for a tool it left out.
export interface OfflineCall {
  tool: string;
  arguments: unknown;
  toolUseId: string | null;
  at: number;
  replay: boolean;
}

const CLAIMED_SUFFIX = '.replaying';

// Whether `id` names one file in the folder, and no path out of it.
function isOneSegment(id: string): boolean {
  const isDotName = id === '.' || id === '..';
  const holdsSeparator = id.includes('/') || id.includes('\\');
  return id !== '' && !isDotName && !holdsSeparator;
}

// The call one line holds, or the reason it holds none.
function parseCallLine(line: string): OfflineCall | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return errorText(error);
  }
  if (!isJsonObject(value)) {
    return 'not an object';
  }
  const { tool, replay, at, toolUseId } = value;
  if (typeof tool !== 'string') {
    return 'tool is not a string';
  }
  if (typeof replay !== 'boolean') {
    return 'replay is not a boolean';
  }
  if (typeof at !== 'number') {
    return 'at is not a number';
  }
  if (typeof toolUseId !== 'string' && toolUseId !== null) {
    return 'toolUseId is not a string or null';
  }
  return {
    tool,
    arguments: value.arguments ?? {},
    toolUseId,
    at,
    replay,
  };
}

// Routes each replayable call the relay logged in `<folder>/<hostSessionId>.jsonl`,
// in file order, each awaited before the next, then deletes the file. It first
// claims the file by renaming it to `<id>.jsonl.replaying`, an earlier run's
// leftover there deleted, so a line the relay appends meanwhile starts a new
// `<id>.jsonl` that a later replay reads. A bad line and a route that rejects
// are logged and skipped; a failed delete is logged. Resolves to the number of
// calls routed, rejected ones included; 0 with no file. Rejects a host id that
// is not one path segment, reading nothing, and a rename or read failing for
// any reason but a missing file.
export async function replayOfflineCalls(
  deps: {
    files: Files;
    paths: Paths;
    folder: string;
    route(call: OfflineCall): Promise<unknown>;
    log: PluginLog;
  },
  hostSessionId: string,
): Promise<number> {
  if (!isOneSegment(hostSessionId)) {
    throw new Error(`Not a host session id: ${hostSessionId}`);
  }
  const { files, paths, log } = deps;
  const file = paths.join(deps.folder, `${hostSessionId}.jsonl`);
  const claimed = `${file}${CLAIMED_SUFFIX}`;
  await files.deleteFile(claimed);
  try {
    await files.rename(file, claimed);
  } catch (error) {
    if (isMissingFile(error)) {
      return 0;
    }
    throw error;
  }
  const lines = (await files.read(claimed)).split('\n');
  let routed = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      continue;
    }
    const call = parseCallLine(line);
    if (typeof call === 'string') {
      log(`offline call line ${index + 1} of ${hostSessionId} not read: ${call}`);
      continue;
    }
    if (!call.replay) {
      continue;
    }
    routed++;
    try {
      await deps.route(call);
    } catch (error) {
      log(
        `offline call ${call.tool} of ${hostSessionId} not replayed: ${errorText(error)}`,
      );
    }
  }
  try {
    await files.deleteFile(claimed);
  } catch (error) {
    log(`offline calls of ${hostSessionId} not deleted: ${errorText(error)}`);
  }
  return routed;
}
