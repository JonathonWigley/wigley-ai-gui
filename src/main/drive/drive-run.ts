import path from 'node:path';
import type { RandomHex } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type { Log } from '../../contracts/log';
import type { DriveHost } from '../../contracts/plugin';
import type { ProcessRunner } from '../../contracts/processes';
import { errorText } from '../../shared/error-text';
import { scopedFiles } from '../../shared/scoped-files';
import { createActionRegistry } from './action-registry';
import { createDriveCommands } from './drive-commands';
import { startDriveServer } from './drive-server';
import type { DrivenWindow } from './driven-window';
import { createFrameRecorder } from './frame-recorder';

export interface DriveRunDeps {
  window: DrivenWindow;
  // The run folder, absolute.
  runDir: string;
  files: Files;
  // The run's temp home, absolute.
  homeDir: string;
  processes: ProcessRunner;
  randomHex: RandomHex;
  // Hears each config the app publishes after a settings change.
  configChanged(listener: () => void): Disposable;
  quit(): void;
  log: Log;
}

export interface DriveRun {
  // The host plugin `pluginId` adds its drive actions through.
  driveFor(pluginId: string): DriveHost;
  // Resolves to the port once the server listens and `drive.json` is written.
  listening: Promise<number>;
  // Finishes a running recording and closes the server.
  dispose(): Promise<void>;
}

// Starts a drive run: the drive actions, the recorder, the commands and their
// HTTP server, behind a fresh 32-hex token. Returns before the server listens,
// so plugins get their hosts while they start; once it listens, writes
// `<runDir>/drive.json` `{ port, token, pid }` for the CLI.
export function startDriveRun(deps: DriveRunDeps): DriveRun {
  const registry = createActionRegistry();
  const recorder = createFrameRecorder({
    window: deps.window,
    files: deps.files,
    processes: deps.processes,
    runDir: deps.runDir,
  });
  const commands = createDriveCommands({
    window: deps.window,
    actions: registry,
    homeFiles: scopedFiles(deps.files, deps.homeDir),
    runDir: deps.runDir,
    files: deps.files,
    recorder,
    configChanged: deps.configChanged,
    quit: deps.quit,
  });
  const token = Array.from({ length: 4 }, () => deps.randomHex()).join('');
  const server = startDriveServer({ token, run: commands.run });
  const listening = server.then(async ({ port }) => {
    await deps.files.write(
      path.join(deps.runDir, 'drive.json'),
      JSON.stringify({ port, token, pid: process.pid }),
    );
    deps.log('main', `drive run listening on ${port}`);
    return port;
  });
  return {
    driveFor: registry.hostFor,
    listening,
    dispose: async () => {
      commands.dispose();
      if (recorder.isRecording()) {
        try {
          await recorder.stop();
        } catch (error) {
          deps.log('main', `drive run recording lost: ${errorText(error)}`);
        }
      }
      await (await server).close();
    },
  };
}
