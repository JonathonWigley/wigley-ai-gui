import { renameSync, writeFileSync } from 'node:fs';

// Gives `file` all of `text` or leaves it as it was: a crash mid-write leaves no partial file.
export function replaceFile(file: string, text: string) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}
