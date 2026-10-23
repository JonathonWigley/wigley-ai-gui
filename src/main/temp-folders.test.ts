import { describe, expect, it } from 'vitest';
import { tempFolders } from './temp-folders';

describe('tempFolders', () => {
  it('tempFolders_Macos_AddsTmpAndPrivateTmp', () => {
    expect(tempFolders('/private/var/folders/x/T', 'macos')).toEqual([
      '/private/var/folders/x/T',
      '/tmp',
      '/private/tmp',
    ]);
  });

  it('tempFolders_Windows_OsTempOnly', () => {
    expect(
      tempFolders('C:\\Users\\u\\AppData\\Local\\Temp', 'windows'),
    ).toEqual(['C:\\Users\\u\\AppData\\Local\\Temp']);
  });
});
