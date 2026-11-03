import { isAbsolute } from 'node:path';

// The repo clone the app reads each owner's live `default` layout from:
// `baked` when it is an absolute path to a folder, else null.
export async function resolveCloneDir(
  baked: string,
  isFolder: (path: string) => Promise<boolean>,
): Promise<string | null> {
  if (!isAbsolute(baked)) {
    return null;
  }
  return (await isFolder(baked)) ? baked : null;
}
