import type { UserConfig } from '../contracts/user-config';

type EmptiedUserConfig = Pick<
  UserConfig,
  'read' | 'writeSettings' | 'writeKeymap'
>;

// Every call, from any caller, waits here for the call before it to settle.
let queue: Promise<void> = Promise.resolve();

// Writes an empty layer to both user files, whatever a run before this one
// left in them, broken text included. Each call empties the files only once
// the previous call has resolved or rejected, so its read sees that call's
// write, and two self-test scripts' resets never race on the same files.
// Rejects when either of this call's writes is not `written`.
export function emptyUserFiles(userConfig: EmptiedUserConfig): Promise<void> {
  const emptying = queue.then(() => writeEmptyLayers(userConfig));
  queue = emptying.catch(() => undefined);
  return emptying;
}

async function writeEmptyLayers(userConfig: EmptiedUserConfig): Promise<void> {
  const read = await userConfig.read();
  const results = [
    await userConfig.writeSettings({}, read.settings.text),
    await userConfig.writeKeymap({}, read.keymap.text),
  ];
  const failed = results.find((result) => result.type !== 'written');
  if (failed !== undefined) {
    throw new Error(
      `Emptying the user files failed: ${JSON.stringify(failed)}`,
    );
  }
}
