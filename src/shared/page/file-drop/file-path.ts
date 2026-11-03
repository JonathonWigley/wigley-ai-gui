import type { DroppedFile } from '../../../contracts/drops';
import { errorText } from '../../error-text';

// The file's path on disk, or the path `savePasted` saved it under when it
// has none; null when the save fails, which `failed` hears with the error's
// text.
export async function pathOf(
  file: DroppedFile,
  savePasted: (file: DroppedFile) => Promise<string>,
  failed: (file: DroppedFile, error: string) => void,
): Promise<string | null> {
  if (file.path !== '') {
    return file.path;
  }
  try {
    return await savePasted(file);
  } catch (error) {
    failed(file, errorText(error));
    return null;
  }
}
