import { describe, expect, it } from 'vitest';
import type { ChatImage } from '../../../contracts/agent';
import type { DroppedFile } from '../../../contracts/drops';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import {
  type ImageEncoder,
  SHRINK_REFUSED,
} from '../../../shared/page/file-drop/shrink-image';
import { MAX_IMAGE_BASE64, refusalOf } from '../image-rules';
import {
  type ChatDropDeps,
  createAttachments,
  takeChatFiles,
} from './attachments';

const TYPE_REFUSED = 'Only PNG, JPEG, GIF and WebP images can be attached';
const SIZE_REFUSED = 'Images over 5 MB cannot be attached';

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const gif: ChatImage = { mediaType: 'image/gif', data: 'Z2lm' };

describe('refusalOf', () => {
  it.each([
    { type: 'application/pdf', length: 10, refusal: TYPE_REFUSED },
    { type: 'image/jpeg', length: MAX_IMAGE_BASE64 + 1, refusal: SIZE_REFUSED },
    { type: 'image/webp', length: MAX_IMAGE_BASE64, refusal: null },
  ])('$type of length $length → $refusal', ({ type, length, refusal }) => {
    expect(refusalOf(type, length)).toBe(refusal);
  });
});

describe('attachments', () => {
  it('removeLast_Empty_False', () => {
    const attachments = createAttachments();

    expect(attachments.removeLast()).toBe(false);
  });

  it('onChange_AddAndRemove_Reports', () => {
    const attachments = createAttachments();
    const reported: ChatImage[][] = [];
    attachments.onChange((images) => reported.push(images));

    attachments.add(png);
    attachments.add(gif);
    attachments.removeAt(0);
    const removed = attachments.removeLast();

    expect(removed).toBe(true);
    expect(reported).toEqual([[png], [png, gif], [gif], []]);
  });
});

// The largest byte count whose base64 text is at most the cap.
const LARGEST_ACCEPTED_BYTES = (MAX_IMAGE_BASE64 / 4) * 3;

const SAVED_PATH = '/app/pasted/20261102-090000-1.txt';

// A file whose `bytes()` resolves `bytes`, or rejects when given an Error.
function fileOf(
  name: string,
  mediaType: string,
  path: string,
  bytes: Uint8Array | Error = new Uint8Array(),
): DroppedFile {
  return {
    name,
    mediaType,
    path,
    bytes: () =>
      bytes instanceof Error ? Promise.reject(bytes) : Promise.resolve(bytes),
  };
}

// An encoder answering `byteCount` zero bytes at every scale, or rejecting
// when given an Error.
function encoderOf(byteCount: number | Error): ImageEncoder {
  return {
    encode: () =>
      byteCount instanceof Error
        ? Promise.reject(byteCount)
        : Promise.resolve(new Uint8Array(byteCount)),
  };
}

type ReportCall =
  | ['attached', ChatImage]
  | ['refused', string]
  | ['failed', string, 'read' | 'saved', string]
  | ['inserted', readonly string[]];

// Deps that record what a take did: a box answering `charBeforeCursor` 'x',
// a `savePasted` answering SAVED_PATH unless given an Error to reject with.
function recordingDeps(
  options: { encoder?: ImageEncoder; saveError?: Error } = {},
) {
  const attached: ChatImage[] = [];
  const inserts: string[] = [];
  const saved: string[] = [];
  const reported: ReportCall[] = [];
  const deps: ChatDropDeps = {
    attachments: { add: (image) => attached.push(image) },
    box: {
      insert: (text) => inserts.push(text),
      charBeforeCursor: () => 'x',
    },
    savePasted: (file) => {
      saved.push(file.name);
      return options.saveError === undefined
        ? Promise.resolve(SAVED_PATH)
        : Promise.reject(options.saveError);
    },
    encoder: options.encoder ?? encoderOf(new Error('encoder called')),
    report: {
      attached: (image) => reported.push(['attached', image]),
      refused: (reason) => reported.push(['refused', reason]),
      failed: (name, what, error) =>
        reported.push(['failed', name, what, error]),
      inserted: (paths) => reported.push(['inserted', paths]),
    },
  };
  return { deps, attached, inserts, saved, reported };
}

const threeBytes = new Uint8Array([1, 2, 3]);
const pngImage: ChatImage = { mediaType: 'image/png', data: 'AQID' };
const gifImage: ChatImage = { mediaType: 'image/gif', data: 'BAUG' };

describe('takeChatFiles', () => {
  it.each([
    {
      label: 'a PNG on disk',
      files: [fileOf('a.png', 'image/png', '/d/a.png', threeBytes)],
      attached: [pngImage],
      paths: [],
      saved: [],
    },
    {
      label: 'a pasted PNG',
      files: [fileOf('image.png', 'image/png', '', threeBytes)],
      attached: [pngImage],
      paths: [],
      saved: [],
    },
    {
      label: 'a PDF on disk',
      files: [fileOf('a b.pdf', 'application/pdf', '/d/a b.pdf')],
      attached: [],
      paths: ['/d/a b.pdf'],
      saved: [],
    },
    {
      label: 'a pasted text file',
      files: [fileOf('notes.txt', 'text/plain', '')],
      attached: [],
      paths: [SAVED_PATH],
      saved: ['notes.txt'],
    },
    {
      label: 'images and other files mixed',
      files: [
        fileOf('1.png', 'image/png', '/d/1.png', threeBytes),
        fileOf('v.mp4', 'video/mp4', '/d/v.mp4'),
        fileOf('2.gif', 'image/gif', '/d/2.gif', new Uint8Array([4, 5, 6])),
        fileOf('f', '', '/d/f'),
      ],
      attached: [pngImage, gifImage],
      paths: ['/d/v.mp4', '/d/f'],
      saved: [],
    },
  ])(
    'takeChatFiles_EachFile_GoesWhereItsKindGoes: $label',
    async ({ files, attached, paths, saved }) => {
      const taken = recordingDeps();

      await takeChatFiles(files, taken.deps);

      const insertedPaths: ReportCall[] =
        paths.length > 0 ? [['inserted', paths]] : [];
      expect(taken.attached).toEqual(attached);
      expect(taken.inserts).toEqual(
        paths.length > 0 ? [insertionText(paths, 'x')] : [],
      );
      expect(taken.saved).toEqual(saved);
      expect(taken.reported).toEqual([
        ...attached.map((image): ReportCall => ['attached', image]),
        ...insertedPaths,
      ]);
    },
  );

  it.each([
    {
      label: 'a JPEG that shrinks',
      mediaType: 'image/jpeg',
      encoded: 300,
      attached: [{ mediaType: 'image/jpeg', data: 'A'.repeat(400) }],
      refused: [],
    },
    {
      label: 'a PNG no step brings under the cap',
      mediaType: 'image/png',
      encoded: LARGEST_ACCEPTED_BYTES + 1,
      attached: [],
      refused: [SHRINK_REFUSED],
    },
  ])(
    'takeChatFiles_OverCap_ShrinksOrRefuses: $label',
    async ({ mediaType, encoded, attached, refused }) => {
      const taken = recordingDeps({ encoder: encoderOf(encoded) });
      const file = fileOf(
        'big',
        mediaType,
        '/d/big',
        new Uint8Array(LARGEST_ACCEPTED_BYTES + 1),
      );

      await takeChatFiles([file], taken.deps);

      expect(taken.attached).toEqual(attached);
      expect(
        taken.reported
          .filter((call) => call[0] === 'refused')
          .map((call) => call[1]),
      ).toEqual(refused);
    },
  );

  const gifAfter = fileOf(
    '2.gif',
    'image/gif',
    '/d/2.gif',
    new Uint8Array([4, 5, 6]),
  );
  it.each([
    {
      label: 'a PNG whose bytes are gone',
      files: [
        fileOf('a.png', 'image/png', '/d/a.png', new Error('gone')),
        gifAfter,
      ],
      options: {},
      failed: ['failed', 'a.png', 'read', 'gone'],
      attached: [gifImage],
      paths: [],
    },
    {
      label: 'a pasted text file not saved',
      files: [
        fileOf('t.txt', 'text/plain', ''),
        fileOf('v.mp4', 'video/mp4', '/d/v.mp4'),
      ],
      options: { saveError: new Error('disk full') },
      failed: ['failed', 't.txt', 'saved', 'disk full'],
      attached: [],
      paths: ['/d/v.mp4'],
    },
    {
      label: 'an over-cap PNG the encoder cannot read',
      files: [
        fileOf(
          'a.png',
          'image/png',
          '/d/a.png',
          new Uint8Array(LARGEST_ACCEPTED_BYTES + 1),
        ),
        gifAfter,
      ],
      options: { encoder: encoderOf(new Error('bad image')) },
      failed: ['failed', 'a.png', 'read', 'bad image'],
      attached: [gifImage],
      paths: [],
    },
  ])(
    'takeChatFiles_OneFails_RestTaken: $label',
    async ({ files, options, failed, attached, paths }) => {
      const taken = recordingDeps(options);

      await takeChatFiles(files, taken.deps);

      expect(taken.reported.filter((call) => call[0] === 'failed')).toEqual([
        failed,
      ]);
      expect(taken.attached).toEqual(attached);
      expect(taken.inserts).toEqual(
        paths.length > 0 ? [insertionText(paths, 'x')] : [],
      );
    },
  );
});
