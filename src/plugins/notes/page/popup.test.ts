import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DropTarget, DroppedFile } from '../../../contracts/drops';
import type { EditorEvents, TextEditor } from '../../../contracts/editor';
import type { ImageEncoder } from '../../../contracts/images';
import type { MarkupEditor, MarkupSession } from '../../../contracts/markup';
import type {
  PageChannel,
  PageServices,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { insertionText } from '../../../shared/page/file-drop/file-chips';
import { SHRINK_REFUSED } from '../../../shared/shrink-image';
import { MAX_IMAGE_BASE64 } from '../../../shared/image-types';
import {
  recordingAnchors,
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  findAll,
  type FocusFakeDocument,
  type FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  NoteDraft,
  NoteFields,
  NoteSendResult,
  NoteSession,
  NotesChannel,
} from '../contract';
import { emptyDraft } from '../draft';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createNotePopup, type NotePopup } from './popup';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

const settle = () => new Promise((resolve) => setImmediate(resolve));

const SESSIONS: NoteSession[] = [
  {
    sessionId: 'a',
    harness: 'claude',
    hostSessionId: 'host-a',
    projectDir: '/home/me/a',
  },
  {
    sessionId: 'b',
    harness: 'claude',
    hostSessionId: 'host-b',
    projectDir: '/home/me/b',
  },
];

const DRAFT: NoteDraft = {
  ...emptyDraft(3),
  fresh: false,
  images: [
    { id: 1, hasMarkup: false },
    { id: 2, hasMarkup: false },
  ],
};

const PASTED_PATH = '/app/pasted/20261102-090000-1.txt';

const AUTOSAVE_DELAY_MS = 1000;

// The most bytes whose base64 text fits the cap.
const CAP_BYTES = (MAX_IMAGE_BASE64 / 4) * 3;

// A row in its own look, so a test sees which rows drew with it.
const MINE_ROW: Layout = {
  row(parent, input, kit) {
    const root = kit.el(parent, 'section', 'mine-row');
    kit.el(root, 'em', '', input.label);
    kit.valueSlot(root);
    return { element: root };
  },
};

// The markup session the fake editor opened: the tools set on it and whether
// it was disposed.
interface FakeMarkup {
  tools: string[];
  isDisposed: boolean;
}

interface Harness {
  popup: NotePopup;
  // The Note dialog's scrim.
  root: FakeElement;
  doc: FocusFakeDocument;
  title: FocusFakeElement;
  bodyFrame: FakeElement;
  body: TextEditor;
  markups: FakeMarkup[];
  logged: string[];
  toasts: [string, ToastTone][];
  // The bytes of each `addImage` call, in order.
  added: number[][];
  // The text of each body `insert` call, in order.
  inserts: string[];
  // The fields of each `saveDraft` call, in order.
  saved: NoteFields[];
  // How many pushed scopes `pop` was called on.
  pops(): number;
  // The arguments of each `saveMarkup` call, in order.
  savedMarkups: [number, string][];
  // Reports a change from the open markup session's editor.
  changeMarkup(): void;
  // The timers set and not yet run or cleared.
  liveTimers(): number;
  // Moves the fake clock by `ms`, running each timer that came due.
  advance(ms: number): void;
  // What the popup's drop target, the core's save and main's `addImage` do;
  // a test replaces one before it acts.
  fakes: Fakes;
  // Hands `files` to the popup's drop target, as the core does.
  take(files: readonly DroppedFile[]): void;
}

interface Fakes {
  savePasted(file: DroppedFile): Promise<string>;
  encode: ImageEncoder['encode'];
  addImage(bytes: Uint8Array): Promise<NoteDraft>;
  sendToFollowup(): Promise<NoteSendResult>;
}

function droppedFile(
  name: string,
  mediaType: string,
  path: string,
  bytes: Uint8Array = new Uint8Array(),
): DroppedFile {
  return { name, mediaType, path, bytes: () => Promise.resolve(bytes) };
}

const png = (name: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])) =>
  droppedFile(name, 'image/png', `/d/${name}`, bytes);

// A text box whose `focus` makes its frame the active element, as the editor
// focuses its own content inside the frame.
// `insert` records its text into `inserts` and reports `changed`, as the real
// one does.
function fakeEditor(
  doc: FocusFakeDocument,
  parent: HTMLElement,
  events: EditorEvents,
  inserts: string[],
): TextEditor {
  let text = '';
  return {
    text: () => text,
    setText(next) {
      text = next;
    },
    insert(inserted) {
      inserts.push(inserted);
      text += inserted;
      events.changed(text);
    },
    charBeforeCursor: () => '',
    focus() {
      doc.activeElement = asFake(parent);
      events.focused();
    },
    blur() {
      if (doc.activeElement === asFake(parent)) {
        doc.activeElement = null;
      }
      events.blurred();
    },
    destroy: () => undefined,
  };
}

function fakeMarkupEditor(
  markups: FakeMarkup[],
  changeListeners: (() => void)[],
): MarkupEditor {
  return {
    open() {
      const made: FakeMarkup = { tools: [], isDisposed: false };
      markups.push(made);
      return Promise.resolve({
        setTool: (tool: string) => made.tools.push(tool),
        setColour: () => undefined,
        undo: () => undefined,
        redo: () => undefined,
        onChange: (listener: () => void) => changeListeners.push(listener),
        finishEdit: () => undefined,
        toJson: () => '{}',
        toPng: () => Promise.resolve(new Uint8Array()),
        dispose() {
          made.isDisposed = true;
        },
      } as unknown as MarkupSession);
    },
  } as unknown as MarkupEditor;
}

// Timers a test runs by hand, as `advance` moves the clock.
function handTimers() {
  const pending = new Map<number, { run: () => void; dueAt: number }>();
  let now = 0;
  let lastHandle = 0;
  return {
    timers: {
      set(run: () => void, ms: number) {
        lastHandle += 1;
        pending.set(lastHandle, { run, dueAt: now + ms });
        return lastHandle;
      },
      clear(handle: number) {
        pending.delete(handle);
      },
    },
    live: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [handle, { run, dueAt }] of pending) {
        if (dueAt <= now) {
          pending.delete(handle);
          run();
        }
      }
    },
  };
}

// Main's side: `addImage`, `saveDraft` and `saveMarkup` record what they get.
function fakeChannel(
  draft: NoteDraft,
  fakes: Fakes,
  added: number[][],
  saved: NoteFields[],
  savedMarkups: [number, string][],
): PageChannel<NotesChannel> {
  return {
    invoke(name: string, ...args: unknown[]) {
      switch (name) {
        case 'loadDraft':
          return Promise.resolve(draft);
        case 'homes':
          return Promise.resolve({ homes: [], message: null });
        case 'image':
          return Promise.resolve(new Uint8Array([1]));
        case 'markup':
          return Promise.resolve(null);
        case 'addImage': {
          const bytes = args[0] as Uint8Array;
          added.push([...bytes]);
          return fakes.addImage(bytes);
        }
        case 'saveDraft':
          saved.push(args[0] as NoteFields);
          return Promise.resolve();
        case 'saveMarkup':
          savedMarkups.push([args[0] as number, args[1] as string]);
          return Promise.resolve(draft);
        case 'sendToFollowup':
          return fakes.sendToFollowup();
        default:
          return Promise.reject(new Error(`no ${name} in the fake`));
      }
    },
  } as unknown as PageChannel<NotesChannel>;
}

// The popup over fakes, opened on `draft`, its body focused.
async function openPopup(draft: NoteDraft = DRAFT): Promise<Harness> {
  const doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  Object.assign(doc, { addEventListener: () => undefined });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'red' }));
  const roots: HTMLElement[] = [];
  const markups: FakeMarkup[] = [];
  const logged: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const added: number[][] = [];
  const inserts: string[] = [];
  const saved: NoteFields[] = [];
  const savedMarkups: [number, string][] = [];
  const markupChangeListeners: (() => void)[] = [];
  const time = handTimers();
  let images = draft.images;
  const fakes: Fakes = {
    savePasted: () => Promise.resolve(PASTED_PATH),
    encode: () => Promise.reject(new Error('no encode in the fake')),
    addImage() {
      const id = draft.nextImageId + images.length;
      images = [...images, { id, hasMarkup: false }];
      return Promise.resolve({ ...draft, images });
    },
    sendToFollowup: () => new Promise(() => undefined),
  };
  const targets: DropTarget[] = [];
  let body: TextEditor | null = null;
  let pops = 0;
  const pushed = (): PushedScope => ({
    pop() {
      pops += 1;
    },
    dispose: () => undefined,
    onBaseChanged: () => ({ dispose: () => undefined }),
  });
  const services = {
    editor: {
      create(parent: HTMLElement, _doc: string, events: EditorEvents) {
        const editor = fakeEditor(doc, parent, events, inserts);
        if (parent.classList.contains('notes-body')) {
          body = editor;
        }
        return editor;
      },
    },
    markdown: {
      block: () => '',
      inline: () => '',
      document: () => Promise.resolve(''),
      ...NO_FENCES,
    },
    markup: fakeMarkupEditor(markups, markupChangeListeners),
    toast: (text: string, tone: ToastTone) => toasts.push([text, tone]),
    log: (line: string) => logged.push(line),
    timers: time.timers,
    clock: { now: () => 0 },
    paths: posixPaths,
    homeDir: '/home/me',
    uiState: { get: () => undefined, set: () => undefined },
  } as unknown as PageServices;
  const popup = createNotePopup({
    channel: fakeChannel(draft, fakes, added, saved, savedMarkups),
    services,
    keys: recordingAnchors().keys,
    overlay: {
      contribute(element) {
        roots.push(element);
        return { dispose: () => undefined };
      },
    },
    commands: { exists: () => true, run: () => undefined },
    platform: 'macos',
    pushScope: pushed,
    autosaveDelayMs: () => AUTOSAVE_DELAY_MS,
    selectedSession: () => null,
    sessionRows: () => SESSIONS,
    drops: {
      addTarget(target) {
        targets.push(target);
        return { dispose: () => undefined };
      },
      savePasted: (file) => fakes.savePasted(file),
    },
    encoder: { encode: (...args) => fakes.encode(...args) },
  });
  popup.commands.open();
  await settle();
  const root = asFake(roots[0]);
  const [title] = findAll(root, 'notes-title');
  const [bodyFrame] = findAll(root, 'notes-body');
  return {
    popup,
    root,
    doc,
    title: title as FocusFakeElement,
    bodyFrame,
    body: body as unknown as TextEditor,
    markups,
    logged,
    toasts,
    added,
    inserts,
    saved,
    pops: () => pops,
    savedMarkups,
    changeMarkup() {
      for (const listener of markupChangeListeners) {
        listener();
      }
    },
    liveTimers: time.live,
    advance: time.advance,
    fakes,
    take: (files) => targets[0].take(files),
  };
}

describe('note popup', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      box: 'title',
      focus(harness: Harness) {
        harness.body.blur();
        harness.title.focus();
        harness.title.fire('focus');
      },
      boxOf: (harness: Harness) => harness.title,
    },
    {
      box: 'body',
      focus: () => undefined,
      boxOf: (harness: Harness) => harness.bodyFrame,
    },
  ])(
    'popupSetLayouts_BoxFocused_FocusesItAgainInTheNewRow ($box)',
    async ({ focus, boxOf }) => {
      const harness = await openPopup();
      focus(harness);

      harness.popup.setLayouts(withUser(defaultLayout, MINE_ROW));

      const box = boxOf(harness);
      expect(harness.doc.activeElement).toBe(box);
      const rows = findAll(harness.root, 'mine-row');
      expect(rows.some((row) => row.contains(box))).toBe(true);
    },
  );

  it.each([
    {
      case: 'session picker',
      open(harness: Harness) {
        harness.popup.commands.pickSession();
      },
      layout: {
        pickerRow(parent, input, kit) {
          const root = kit.el(parent, 'li', 'mine-picker-row', input.label);
          return { element: root };
        },
      } satisfies Layout,
      check(harness: Harness) {
        const rows = findAll(harness.root, 'mine-picker-row');
        expect(rows.map((row) => row.dataset.layout)).toEqual([
          USER_LAYOUT,
          USER_LAYOUT,
        ]);
        harness.popup.commands.pickerDown();
        harness.popup.commands.pickerChoose();
        expect(harness.logged).toContain('session host-b');
      },
    },
    {
      case: 'markup view',
      open(harness: Harness) {
        harness.popup.commands.nextField();
        harness.popup.commands.nextField();
        harness.popup.commands.act();
      },
      layout: {
        markupToolbar(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-toolbar');
          kit.toolButton(root, 'arrow');
          return { element: root };
        },
      } satisfies Layout,
      check(harness: Harness) {
        expect(findAll(harness.root, 'mine-toolbar')).toHaveLength(1);
        harness.popup.commands.toolArrow();
        expect(harness.markups).toEqual([
          { tools: ['pen', 'arrow'], isDisposed: false },
        ]);
      },
    },
  ])(
    'popupSetLayouts_OverlayOpen_KeepsItOpen ($case)',
    async ({ open, layout, check }) => {
      const harness = await openPopup();
      open(harness);
      await settle();

      harness.popup.setLayouts(withUser<Layout>(defaultLayout, layout));

      check(harness);
    },
  );

  it.each([
    {
      files: [png('a.png')],
      added: [[1, 2, 3]],
      inserts: [],
    },
    {
      files: [droppedFile('a b.md', 'text/markdown', '/d/a b.md')],
      added: [],
      inserts: [insertionText(['/d/a b.md'], '')],
    },
    {
      files: [droppedFile('n.txt', 'text/plain', '')],
      added: [],
      inserts: [insertionText([PASTED_PATH], '')],
    },
    {
      files: [
        png('a.png', new Uint8Array([1, 2, 3])),
        droppedFile('v.mp4', 'video/mp4', '/d/v.mp4'),
        png('b.png', new Uint8Array([4, 5])),
      ],
      added: [
        [1, 2, 3],
        [4, 5],
      ],
      inserts: [insertionText(['/d/v.mp4'], '')],
    },
  ])(
    'take_EachFile_GoesWhereItsKindGoes ($files.length files)',
    async ({ files, added, inserts }) => {
      const harness = await openPopup();

      harness.take(files);
      await settle();

      expect(harness.added).toEqual(added);
      expect(harness.inserts).toEqual(inserts);
    },
  );

  it('take_PathInserted_ReachesTheDraftBody', async () => {
    const harness = await openPopup();

    harness.take([droppedFile('a b.md', 'text/markdown', '/d/a b.md')]);
    await settle();
    harness.popup.commands.close();
    await settle();

    expect(harness.saved.at(-1)?.body).toBe(insertionText(['/d/a b.md'], ''));
  });

  it('take_PastedFileSaveRejects', async () => {
    const harness = await openPopup();
    harness.fakes.savePasted = () => Promise.reject(new Error('disk full'));

    harness.take([
      droppedFile('bad.txt', 'text/plain', ''),
      droppedFile('a.md', 'text/markdown', '/d/a.md'),
    ]);
    await settle();

    expect(harness.toasts).toEqual([['bad.txt not saved: disk full', 'error']]);
    expect(harness.inserts).toEqual([insertionText(['/d/a.md'], '')]);
  });

  it.each([
    {
      change: 'popup closed',
      act: (harness: Harness) => {
        harness.popup.commands.close();
        return Promise.resolve();
      },
    },
    {
      change: 'send started',
      act: (harness: Harness) => {
        harness.popup.commands.sendFollowup();
        return Promise.resolve();
      },
    },
    {
      change: 'popup reopened on its draft',
      act: async (harness: Harness) => {
        harness.popup.commands.close();
        harness.popup.commands.open();
        await settle();
      },
    },
  ])(
    'take_StateChangedDuringSave_ToastsPathsInsertsNothing ($change)',
    async ({ act }) => {
      const harness = await openPopup({
        ...DRAFT,
        target: '/home/me/a',
        title: 'A note',
      });
      harness.fakes.savePasted = async () => {
        await act(harness);
        return PASTED_PATH;
      };

      harness.take([droppedFile('n.txt', 'text/plain', '')]);
      await settle();
      await settle();

      expect(harness.inserts).toEqual([]);
      expect(
        harness.toasts.filter(([text]) => text.includes(PASTED_PATH)),
      ).toEqual([[expect.stringContaining(PASTED_PATH), 'info']]);
    },
  );

  // Each row's attach hangs in main while the pasted file saves.
  it.each([
    {
      attaching: 'this take',
      files: [png('own.png')],
      duringSave: () => undefined,
    },
    {
      attaching: 'another take',
      files: [],
      duringSave: (harness: Harness) => harness.take([png('other.png')]),
    },
  ])(
    'take_AttachInFlightDuringSave_InsertsPaths ($attaching)',
    async ({ files, duringSave }) => {
      const harness = await openPopup();
      harness.fakes.addImage = () => new Promise(() => undefined);
      harness.fakes.savePasted = () => {
        duringSave(harness);
        return Promise.resolve(PASTED_PATH);
      };

      harness.take([...files, droppedFile('n.txt', 'text/plain', '')]);
      await settle();

      expect(harness.inserts).toEqual([insertionText([PASTED_PATH], '')]);
      expect(harness.toasts).toEqual([]);
    },
  );

  it.each([
    {
      case: 'shrunk',
      encoded: new Uint8Array(300).fill(7),
      added: [Array.from({ length: 300 }, () => 7)],
      toasts: [],
    },
    {
      case: 'refused',
      encoded: new Uint8Array(CAP_BYTES + 1),
      added: [],
      toasts: [SHRINK_REFUSED],
    },
  ])(
    'take_OverCapPng_ShrinksOrRefuses ($case)',
    async ({ encoded, added, toasts }) => {
      const harness = await openPopup();
      harness.fakes.encode = () => Promise.resolve(encoded);

      harness.take([png('big.png', new Uint8Array(CAP_BYTES + 1))]);
      await settle();

      expect(harness.added).toEqual(added);
      expect(harness.toasts.map(([text]) => text)).toEqual(toasts);
    },
  );

  it.each([
    {
      state: 'popup closed',
      setUp: (harness: Harness) => harness.popup.commands.close(),
    },
    {
      state: 'discard confirmation showing',
      setUp: (harness: Harness) => harness.popup.commands.discard(),
    },
    {
      state: 'addImage of an earlier take pending',
      setUp(harness: Harness) {
        harness.fakes.addImage = () => new Promise(() => undefined);
        harness.take([png('earlier.png')]);
      },
    },
  ])('take_WhileNotEditable_TakesNothing ($state)', async ({ setUp }) => {
    const harness = await openPopup();
    setUp(harness);
    await settle();
    const addedBefore = harness.added.length;

    harness.take([
      png('a.png'),
      droppedFile('a.md', 'text/markdown', '/d/a.md'),
    ]);
    await settle();

    expect(harness.added.slice(addedBefore)).toEqual([]);
    expect(harness.inserts).toEqual([]);
  });

  it('dispose_MarkupOpen_SavesAndHidesIt', async () => {
    const harness = await openPopup();
    harness.popup.commands.nextField();
    harness.popup.commands.nextField();
    harness.popup.commands.act();
    await settle();
    harness.changeMarkup();

    harness.popup.dispose();
    await settle();

    expect(harness.savedMarkups).toEqual([[1, '{}']]);
    expect(harness.markups[0].isDisposed).toBe(true);
  });

  it('dispose_AfterEdit_SchedulesNoSave', async () => {
    const harness = await openPopup();
    harness.body.insert('an edit');
    expect(harness.liveTimers()).toBeGreaterThan(0);
    const savedBefore = harness.saved.length;

    harness.popup.dispose();
    harness.advance(AUTOSAVE_DELAY_MS);
    await settle();

    expect(harness.saved).toHaveLength(savedBefore);
  });

  it('dispose_SendInFlight_LateSentPopsNoScope', async () => {
    const harness = await openPopup({
      ...DRAFT,
      target: '/home/me/a',
      title: 'A note',
    });
    let answerSend: (result: NoteSendResult) => void = () => undefined;
    harness.fakes.sendToFollowup = () =>
      new Promise((resolve) => {
        answerSend = resolve;
      });
    harness.popup.commands.sendFollowup();
    await settle();

    harness.popup.dispose();
    const popsAtDispose = harness.pops();
    answerSend({ type: 'sent', draft: DRAFT, toast: 'Follow-up added' });
    await settle();

    expect(harness.pops()).toBe(popsAtDispose);
    expect(harness.toasts).toEqual([['Follow-up added', 'success']]);
  });
});
