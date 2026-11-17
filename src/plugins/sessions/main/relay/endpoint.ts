import path from 'node:path';
import type { Files } from '../../../../contracts/files';
import type { PluginLog } from '../../../../contracts/log';
import type { OsName } from '../../../../contracts/platform';
import { errorText } from '../../../../shared/error-text';
import { createSerialQueue } from '../../../../shared/serial-queue';
import type { RelayEndpoint, ToolDefinition } from '../../contract';

// How a relay that finds a drive run gone "starts" it: a shell that exits 1
// with the run's home named in the command's text, which the relay reports,
// so the relay never starts the user's own app in the run's place. Runs in
// the home's filesystem root, which outlives the run.
export function endedDriveRunLaunch(
  os: OsName,
  homeDir: string,
): RelayEndpoint['launch'] {
  const ended = `The drive run whose home is ${homeDir} has ended`;
  if (os === 'windows') {
    // cmd reads everything after `rem` as a comment, `&` included.
    return {
      command: ['cmd.exe', '/d', '/c', `exit 1 & rem ${ended}`],
      cwd: path.win32.parse(homeDir).root,
    };
  }
  return {
    command: ['/bin/sh', '-c', 'echo "$0" >&2; exit 1', ended],
    cwd: path.posix.parse(homeDir).root,
  };
}

// Writes `endpoint.json`, which tells relays where the app is and how to
// start it, and `tools.json`, the tool list a relay serves while the app is
// away, into `dir`, making it. Each write runs once every earlier one has
// settled; a failed one is logged, and the next still runs. `Files.write` is
// atomic, so a relay never reads half a file.
export interface EndpointWriter {
  // Queues one write of both files with this endpoint and tool list; returns at once.
  write(endpoint: RelayEndpoint, tools: ToolDefinition[]): void;
  // Settles once every write queued before the call has settled.
  flushed(): Promise<void>;
}

export function createEndpointWriter(
  files: Files,
  dir: string,
  log: PluginLog,
): EndpointWriter {
  const queue = createSerialQueue();
  const writeJson = (name: string, value: unknown) =>
    files.write(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  return {
    write(endpoint, tools) {
      queue
        .run(async () => {
          await writeJson('endpoint.json', endpoint);
          await writeJson('tools.json', { tools });
        })
        .catch((error: unknown) =>
          log(`endpoint files not written: ${errorText(error)}`),
        );
    },
    flushed: () => queue.settled(),
  };
}
