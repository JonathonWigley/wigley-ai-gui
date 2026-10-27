import { describe, expect, it } from 'vitest';
import type { ChatImage } from '../../../contracts/agent';
import { MAX_IMAGE_BASE64, refusalOf } from '../image-rules';
import {
  createAttachments,
  listenForImages,
  refusalOfFile,
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

// The largest byte count whose base64 text is at most the cap.
const LARGEST_ACCEPTED_BYTES = (MAX_IMAGE_BASE64 / 4) * 3;

describe('refusalOfFile', () => {
  it.each([
    { type: 'image/png', size: LARGEST_ACCEPTED_BYTES, refusal: null },
    {
      type: 'image/png',
      size: LARGEST_ACCEPTED_BYTES + 1,
      refusal: SIZE_REFUSED,
    },
    { type: 'video/mp4', size: 500 * 1024 * 1024, refusal: TYPE_REFUSED },
  ])('$type of $size bytes → $refusal', ({ type, size, refusal }) => {
    expect(refusalOfFile({ type, size })).toBe(refusal);
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

describe('listenForImages paste', () => {
  // A PNG over the size limit: attaching it is refused, which toasts, so a
  // toast shows the paste was taken without reading the file.
  const oversizePng = {
    type: 'image/png',
    size: MAX_IMAGE_BASE64 * 2,
    name: 'a.png',
  };

  function pasteWith(text: string) {
    let onPaste: (event: Event) => void = () => {};
    const composer = {
      addEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === 'paste') {
          onPaste = listener;
        }
      },
    } as unknown as HTMLElement;
    const root = { addEventListener: () => {} } as unknown as HTMLElement;
    const toasts: string[] = [];
    listenForImages(
      { name: 'Chat 1', attachments: createAttachments() },
      root,
      {
        log: () => {},
        toast: (message) => toasts.push(message),
      },
    ).listenForPaste(composer);
    let prevented = false;
    onPaste({
      clipboardData: {
        files: [oversizePng],
        getData: (format: string) => (format === 'text/plain' ? text : ''),
      },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Event);
    return { toasts, prevented };
  }

  it.each([
    { text: 'a1\tb1', attached: false },
    { text: '', attached: true },
    { text: ` ${oversizePng.name}\n`, attached: true },
    { text: 'https://example.com/a.png', attached: true },
    { text: '  \n\t ', attached: true },
    { text: `${oversizePng.name} was here`, attached: false },
    { text: 'see https://example.com', attached: false },
  ])(
    'a file pasted with text $text is attached: $attached',
    ({ text, attached }) => {
      const { toasts, prevented } = pasteWith(text);

      expect(prevented).toBe(attached);
      expect(toasts).toHaveLength(attached ? 1 : 0);
    },
  );
});
