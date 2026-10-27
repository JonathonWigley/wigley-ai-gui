import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  appendedBody,
  imageFolderName,
  imageLink,
  imageLinkPrefix,
  linkedImages,
  noteBody,
} from './note-images';

// 2026-10-27T14:03:09Z
const NOW = 1793109789000;
const HOME = '/Users/u/dev/r/docs/features';

describe('note images', () => {
  it('imageFolderName_Title_UtcStampAndSlug', () => {
    expect(imageFolderName(NOW, "Fix the chip's colour!")).toBe(
      '20261027-140309-fix-the-chip-s-colour',
    );
  });

  it('imageFolderName_NoSlug_StampOnly', () => {
    expect(imageFolderName(NOW, '!!!')).toBe('20261027-140309');
  });

  it('imageFolderName_LongTitle_SlugCutTo40', () => {
    expect(imageFolderName(NOW, 'a'.repeat(60))).toBe(
      `20261027-140309-${'a'.repeat(40)}`,
    );
  });

  it('imageFolderName_CutEndsOnDash_DashDropped', () => {
    expect(imageFolderName(NOW, `${'a'.repeat(39)} b`)).toBe(
      `20261027-140309-${'a'.repeat(39)}`,
    );
  });

  it('linkedImages_BothPrefixes_InBodyOrder', () => {
    const body =
      'See ![1](followups-images/F/1.png) and ![2](../followups-images/F/2.png).';

    expect(linkedImages(body)).toEqual([
      { folder: 'F', number: 1, relative: 'followups-images/F/1.png' },
      { folder: 'F', number: 2, relative: '../followups-images/F/2.png' },
    ]);
  });

  it('imageLinkPrefix_AreaFile_OneLevelUp', () => {
    expect(imageLinkPrefix(`${HOME}/followups/ui.md`, HOME, posixPaths)).toBe(
      '../',
    );
    expect(imageLinkPrefix(`${HOME}/followups.md`, HOME, posixPaths)).toBe('');
  });

  it('imageLinkPrefix_FileOutsideHome_Throws', () => {
    expect(() =>
      imageLinkPrefix('/elsewhere/followups.md', HOME, posixPaths),
    ).toThrow('/elsewhere/followups.md');
  });

  it('imageLink_Number_RelativeLink', () => {
    expect(imageLink('', 'F', 2)).toBe('![2](followups-images/F/2.png)');
  });

  it('noteBody_NoLinks_TextOnly', () => {
    expect(noteBody('Text.', [])).toBe('Text.');
    expect(noteBody('Text.', ['L1', 'L2'])).toBe('Text.\n\nL1\nL2');
  });

  it('appendedBody_EmptyBody_AdditionOnly', () => {
    expect(appendedBody(' \n', 'More.')).toBe('More.');
    expect(appendedBody('Old.\n\n', 'More.')).toBe('Old.\n\nMore.');
  });
});
