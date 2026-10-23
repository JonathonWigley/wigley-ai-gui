import { describe, expect, it } from 'vitest';
import type { ChatImage } from '../../../contracts/agent';
import {
  createAttachments,
  listenForImages,
  refusalOf,
  refusalOfFile,
} from './attachments';

const FIVE_MB = 5 * 1024 * 1024;

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const gif: ChatImage = { mediaType: 'image/gif', data: 'Z2lm' };

describe('refusalOf', () => {
  it('refusalOf_Pdf_RefusesType', () => {
    expect(refusalOf('application/pdf', 10)).toBe(
      'Only PNG, JPEG, GIF and WebP images can be attached',
    );
  });

  it('refusalOf_OverLimit_RefusesSize', () => {
    expect(refusalOf('image/png', 6 * 1024 * 1024)).toBe(
      'Images over 5 MB cannot be attached',
    );
  });

  it('refusalOf_PngAtLimit_Accepts', () => {
    expect(refusalOf('image/png', FIVE_MB)).toBeNull();
  });
});

// The largest byte count whose base64 text is at most 5 MB.
const LARGEST_ACCEPTED_BYTES = (FIVE_MB / 4) * 3;

describe('refusalOfFile', () => {
  it('refusalOfFile_LargestAcceptedSize_Accepts', () => {
    expect(
      refusalOfFile({ type: 'image/png', size: LARGEST_ACCEPTED_BYTES }),
    ).toBeNull();
  });

  it('refusalOfFile_OneByteOver_RefusesSize', () => {
    expect(
      refusalOfFile({ type: 'image/png', size: LARGEST_ACCEPTED_BYTES + 1 }),
    ).toBe('Images over 5 MB cannot be attached');
  });

  it('refusalOfFile_LargeVideo_RefusesType', () => {
    expect(refusalOfFile({ type: 'video/mp4', size: 500 * 1024 * 1024 })).toBe(
      'Only PNG, JPEG, GIF and WebP images can be attached',
    );
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
  const oversizePng = { type: 'image/png', size: FIVE_MB * 2, name: 'a.png' };

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
      { name: 'Chat 1', ended: false, attachments: createAttachments() },
      composer,
      root,
      { log: () => {}, toast: (message) => toasts.push(message) },
    );
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

  it('paste_FileAndText_LeftToEditor', () => {
    const { toasts, prevented } = pasteWith('a1\tb1');

    expect(prevented).toBe(false);
    expect(toasts).toEqual([]);
  });

  it('paste_FileAndNoText_Attached', () => {
    const { toasts, prevented } = pasteWith('');

    expect(prevented).toBe(true);
    expect(toasts).toHaveLength(1);
  });
});
