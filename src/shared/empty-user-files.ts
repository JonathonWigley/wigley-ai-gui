import type { UserConfig } from '../contracts/user-config';

// Writes an empty layer to both user files, whatever a run before this one
// left in them, broken text included. Rejects when either write is not
// `written`.
export async function emptyUserFiles(
  userConfig: Pick<UserConfig, 'read' | 'writeSettings' | 'writeKeymap'>,
): Promise<void> {
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
