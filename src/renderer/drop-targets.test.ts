import { describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../contracts/bridge';
import {
  type DropTarget,
  type DroppedFile,
  NOTHING_TAKES_FILES,
} from '../contracts/drops';
import type { ToastTone } from '../contracts/plugin';
import { createDropTargets, NO_FILES_CARRIED } from './drop-targets';

const PASTED_PATH = '/home/me/pasted/20261102-090507-1.png';

interface FakeElement {
  tagName: string;
  parent: FakeElement | null;
  contains(other: unknown): boolean;
}

function fakeElement(parent: FakeElement | null = null): FakeElement {
  const made: FakeElement = {
    tagName: 'DIV',
    parent,
    contains(other) {
      for (let at = other as FakeElement | null; at !== null; at = at.parent) {
        if (at === made) {
          return true;
        }
      }
      return false;
    },
  };
  return made;
}

// A text input whose `setRangeText` edits `value` as the DOM does with
// `'end'`, counting the `input` events dispatched on it.
function fakeInput(
  parent: FakeElement | null,
  value: string,
  selectionStart = value.length,
  selectionEnd = selectionStart,
) {
  const input = {
    ...fakeElement(parent),
    tagName: 'INPUT',
    type: 'text',
    value,
    selectionStart,
    selectionEnd,
    readOnly: false,
    disabled: false,
    isConnected: true,
    inputEvents: 0,
    setRangeText(text: string, start: number, end: number) {
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      input.selectionStart = start + text.length;
      input.selectionEnd = input.selectionStart;
    },
    dispatchEvent(event: Event) {
      if (event.type === 'input') {
        input.inputEvents += 1;
      }
      return true;
    },
  };
  return input;
}

// A document that keeps only capture-phase listeners, as the registry adds
// them, and runs them in registration order on `dispatch`.
function fakeDocument() {
  const listeners: [string, (event: unknown) => void][] = [];
  const document = {
    activeElement: null as unknown,
    addEventListener(
      type: string,
      listener: (event: unknown) => void,
      options?: AddEventListenerOptions,
    ) {
      if (options?.capture === true) {
        listeners.push([type, listener]);
      }
    },
    dispatch(type: string, event: unknown) {
      for (const [heard, listener] of listeners) {
        if (heard === type) {
          listener(event);
        }
      }
    },
  };
  return document;
}

function fakeTransfer(options: {
  types?: string[];
  files?: File[];
  text?: string;
}) {
  const files = options.files ?? [];
  return {
    types: options.types ?? (files.length > 0 ? ['Files'] : ['text/plain']),
    files,
    dropEffect: 'none',
    getData: (format: string) =>
      format === 'text/plain' ? (options.text ?? '') : '',
  };
}

function fakeEvent(fields: Record<string, unknown>) {
  const event = {
    ...fields,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  return event;
}

function png(name = 'image.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

// The registry over a fake document and bridge, with targets outer ⊃ inner
// recording each `take`.
function setUp(
  options: {
    shown?: boolean;
    save?: () => Promise<string>;
  } = {},
) {
  const document = fakeDocument();
  const paths = new Map<File, string>();
  const saved: [number[], string][] = [];
  const toasts: [string, ToastTone][] = [];
  const bridge: Pick<Bridge, 'pathForFile' | 'savePasted'> = {
    pathForFile: (file) => paths.get(file) ?? '',
    savePasted: (bytes, mediaType) => {
      saved.push([[...bytes], mediaType]);
      return options.save?.() ?? Promise.resolve(PASTED_PATH);
    },
  };
  const drops = createDropTargets({
    document: document as unknown as Document,
    bridge,
    toast: (text, tone) => toasts.push([text, tone]),
    isShown: () => options.shown ?? true,
  });
  const taken: { target: string; files: readonly DroppedFile[] }[] = [];
  const register = (name: string, element: FakeElement) =>
    drops.addTarget({
      element: element as unknown as HTMLElement,
      take: (files) => taken.push({ target: name, files }),
    } satisfies DropTarget);
  const outerElement = fakeElement();
  const innerElement = fakeElement(outerElement);
  const outer = register('outer', outerElement);
  register('inner', innerElement);
  const drop = (target: unknown, transfer: ReturnType<typeof fakeTransfer>) => {
    const event = fakeEvent({ target, dataTransfer: transfer });
    document.dispatch('drop', event);
    return event;
  };
  const paste = (transfer: ReturnType<typeof fakeTransfer>) => {
    const event = fakeEvent({ clipboardData: transfer });
    document.dispatch('paste', event);
    return event;
  };
  return {
    document,
    paths,
    saved,
    toasts,
    taken,
    outer,
    outerElement,
    innerElement,
    drop,
    paste,
  };
}

// Lets a resolved save's continuation run.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createDropTargets', () => {
  it.each<{
    row: string;
    on: 'inner child' | 'outer only' | 'neither' | 'inner, no files';
    taken: string[];
    toasts: [string, ToastTone][];
  }>([
    { row: 'inner child', on: 'inner child', taken: ['inner'], toasts: [] },
    {
      row: 'outer outside inner',
      on: 'outer only',
      taken: ['outer'],
      toasts: [],
    },
    {
      row: 'neither',
      on: 'neither',
      taken: [],
      toasts: [[NOTHING_TAKES_FILES, 'info']],
    },
    {
      row: 'a file drag with no files',
      on: 'inner, no files',
      taken: [],
      toasts: [[NO_FILES_CARRIED, 'info']],
    },
  ])(
    'a drop goes to the innermost target under the pointer: $row',
    ({ on, taken, toasts }) => {
      const fakes = setUp();
      const target = {
        'inner child': fakeElement(fakes.innerElement),
        'outer only': fakeElement(fakes.outerElement),
        neither: fakeElement(),
        'inner, no files': fakes.innerElement,
      }[on];
      const transfer =
        on === 'inner, no files'
          ? fakeTransfer({ types: ['Files'] })
          : fakeTransfer({ files: [png()] });

      fakes.drop(target, transfer);

      expect(fakes.taken.map((take) => take.target)).toEqual(taken);
      expect(fakes.toasts).toEqual(toasts);
    },
  );

  it('a dropped file carries its name, type and path', async () => {
    const fakes = setUp();
    const file = png('a.png');
    fakes.paths.set(file, '/Users/me/a.png');

    fakes.drop(fakes.innerElement, fakeTransfer({ files: [file] }));

    const [dropped] = fakes.taken[0].files;
    expect(dropped).toMatchObject({
      name: 'a.png',
      mediaType: 'image/png',
      path: '/Users/me/a.png',
    });
    expect([...(await dropped.bytes())]).toEqual([1, 2, 3]);
  });

  it.each<{
    row: string;
    focus: 'inner' | 'outer last';
    focusNow?: 'body' | 'email input' | 'contenteditable';
    shown?: boolean;
    disposeOuter?: boolean;
    taken: string[];
  }>([
    { row: 'focus in inner', focus: 'inner', taken: ['inner'] },
    {
      row: 'outer focused last and shown',
      focus: 'outer last',
      taken: ['outer'],
    },
    {
      row: 'outer focused last, not shown',
      focus: 'outer last',
      shown: false,
      taken: [],
    },
    {
      row: 'outer focused last, then disposed',
      focus: 'outer last',
      disposeOuter: true,
      taken: [],
    },
    {
      row: 'outer focused last, focus now on the body',
      focus: 'outer last',
      focusNow: 'body',
      taken: ['outer'],
    },
    {
      row: 'outer focused last, focus now in an email input',
      focus: 'outer last',
      focusNow: 'email input',
      taken: [],
    },
    {
      row: 'outer focused last, focus now in other contenteditable',
      focus: 'outer last',
      focusNow: 'contenteditable',
      taken: [],
    },
  ])(
    'a paste goes to the focused target, else the last focused one still shown while no other field holds focus: $row',
    ({ focus, focusNow, shown, disposeOuter = false, taken }) => {
      const fakes = setUp({ shown });
      if (focus === 'inner') {
        fakes.document.activeElement = fakeElement(fakes.innerElement);
      } else {
        const inOuter = fakeElement(fakes.outerElement);
        fakes.document.dispatch('focusin', { target: inOuter });
        fakes.document.dispatch('focusin', { target: fakeElement() });
        fakes.document.activeElement =
          focusNow === undefined
            ? null
            : {
                body: { ...fakeElement(), tagName: 'BODY' },
                'email input': {
                  ...fakeElement(),
                  tagName: 'INPUT',
                  type: 'email',
                },
                contenteditable: { ...fakeElement(), isContentEditable: true },
              }[focusNow];
      }
      if (disposeOuter) {
        fakes.outer.dispose();
        fakes.outer.dispose();
      }

      const event = fakes.paste(fakeTransfer({ files: [png()] }));

      expect(fakes.taken.map((take) => take.target)).toEqual(taken);
      expect(event.defaultPrevented).toBe(taken.length > 0);
      for (const take of fakes.taken) {
        expect(take.files[0].path).toBe('');
      }
    },
  );

  it.each<{
    row: string;
    text: string;
    files: File[];
    intoInput?: boolean;
    taken: string[];
  }>([
    {
      row: 'text with a file',
      text: 'hello',
      files: [png('a.png')],
      taken: [],
    },
    {
      row: 'the file name as text',
      text: 'a.png',
      files: [png('a.png')],
      taken: ['inner'],
    },
    { row: 'no files', text: 'hello', files: [], taken: [] },
    {
      row: 'text with a file into a one-line input',
      text: 'hello',
      files: [png('a.png')],
      intoInput: true,
      taken: [],
    },
  ])(
    'a paste of real text stays a text paste: $row',
    async ({ text, files, intoInput = false, taken }) => {
      const fakes = setUp();
      const input = fakeInput(fakes.innerElement, 'ab');
      fakes.document.activeElement = intoInput
        ? input
        : fakeElement(fakes.innerElement);

      const event = fakes.paste(fakeTransfer({ files, text }));
      await settle();

      expect(fakes.taken.map((take) => take.target)).toEqual(taken);
      expect(event.defaultPrevented).toBe(taken.length > 0);
      expect(input.value).toBe('ab');
      expect(input.inputEvents).toBe(0);
    },
  );

  it.each<{
    row: string;
    type: 'dragover' | 'drop';
    types: string[];
    cancelled: boolean;
    dropEffect: string;
  }>([
    {
      row: 'file dragover',
      type: 'dragover',
      types: ['Files'],
      cancelled: true,
      dropEffect: 'copy',
    },
    {
      row: 'text dragover',
      type: 'dragover',
      types: ['text/plain'],
      cancelled: false,
      dropEffect: 'none',
    },
    {
      row: 'file drop on a target',
      type: 'drop',
      types: ['Files'],
      cancelled: true,
      dropEffect: 'none',
    },
  ])(
    'every file drag is cancelled: $row',
    ({ type, types, cancelled, dropEffect }) => {
      const fakes = setUp();
      const transfer = fakeTransfer({ types, files: [png()] });
      const event = fakeEvent({
        target: fakes.innerElement,
        dataTransfer: transfer,
      });

      fakes.document.dispatch(type, event);

      expect(event.defaultPrevented).toBe(cancelled);
      expect(transfer.dropEffect).toBe(dropEffect);
    },
  );

  it.each<{
    value: string;
    selectionStart: number;
    selectionEnd: number;
    paths: string[];
    expected: string;
  }>([
    {
      value: 'ab',
      selectionStart: 2,
      selectionEnd: 2,
      paths: ['/a/b'],
      expected: 'ab /a/b',
    },
    {
      value: 'ab ',
      selectionStart: 3,
      selectionEnd: 3,
      paths: ['/a/b'],
      expected: 'ab /a/b',
    },
    {
      value: 'abXXcd',
      selectionStart: 2,
      selectionEnd: 4,
      paths: ['/a/b'],
      expected: 'ab /a/b cd',
    },
    {
      value: 'ab cd',
      selectionStart: 3,
      selectionEnd: 3,
      paths: ['/a/b'],
      expected: 'ab /a/b cd',
    },
    {
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      paths: ['/a/My File.md'],
      expected: '"/a/My File.md"',
    },
  ])(
    'a one-line input takes plain paths at its caret: $value at $selectionStart-$selectionEnd',
    async ({ value, selectionStart, selectionEnd, paths, expected }) => {
      const fakes = setUp();
      const input = fakeInput(
        fakes.innerElement,
        value,
        selectionStart,
        selectionEnd,
      );
      const files = paths.map((path) => {
        const file = new File([], path.slice(path.lastIndexOf('/') + 1));
        fakes.paths.set(file, path);
        return file;
      });

      fakes.drop(input, fakeTransfer({ files }));
      await vi.waitFor(() => expect(input.inputEvents).toBe(1));

      expect(input.value).toBe(expected);
      expect(fakes.taken).toEqual([]);
    },
  );

  it('a file with no path is saved before its path goes in', async () => {
    const fakes = setUp();
    const input = fakeInput(null, '');
    fakes.document.activeElement = input;

    fakes.paste(fakeTransfer({ files: [png()] }));
    await vi.waitFor(() => expect(input.inputEvents).toBe(1));

    expect(fakes.saved).toEqual([[[1, 2, 3], 'image/png']]);
    expect(input.value).toBe(PASTED_PATH);
  });

  it('a failed save inserts nothing', async () => {
    const fakes = setUp({
      save: () => Promise.reject(new Error('disk full')),
    });
    const input = fakeInput(null, 'ab');
    fakes.document.activeElement = input;

    fakes.paste(fakeTransfer({ files: [png()] }));
    await vi.waitFor(() => expect(fakes.toasts).not.toEqual([]));

    expect(fakes.toasts).toEqual([
      ['Pasted file not saved: disk full', 'error'],
    ]);
    expect(input.value).toBe('ab');
    expect(input.inputEvents).toBe(0);
  });

  it('an input gone during the save takes nothing', async () => {
    const fakes = setUp();
    const input = fakeInput(null, 'ab');
    fakes.document.activeElement = input;

    const event = fakes.paste(fakeTransfer({ files: [png()] }));
    input.isConnected = false;
    await vi.waitFor(() => expect(fakes.saved).toHaveLength(1));
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('ab');
    expect(input.inputEvents).toBe(0);
  });
});
