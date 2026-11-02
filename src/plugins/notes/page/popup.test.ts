import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, TextEditor } from '../../../contracts/editor';
import type { MarkupEditor, MarkupSession } from '../../../contracts/markup';
import type {
  PageChannel,
  PageServices,
  PushedScope,
} from '../../../contracts/plugin';
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
import type { NoteDraft, NoteSession, NotesChannel } from '../contract';
import { emptyDraft } from '../draft';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createNotePopup, type NotePopup } from './popup';

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
}

// A text box whose `focus` makes its frame the active element, as the editor
// focuses its own content inside the frame.
function fakeEditor(
  doc: FocusFakeDocument,
  parent: HTMLElement,
  events: EditorEvents,
): TextEditor {
  return {
    text: () => '',
    setText: () => undefined,
    insert: () => undefined,
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

function fakeMarkupEditor(markups: FakeMarkup[]): MarkupEditor {
  return {
    open() {
      const made: FakeMarkup = { tools: [], isDisposed: false };
      markups.push(made);
      return Promise.resolve({
        setTool: (tool: string) => made.tools.push(tool),
        setColour: () => undefined,
        undo: () => undefined,
        redo: () => undefined,
        onChange: () => undefined,
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

const channel = {
  invoke(name: string) {
    switch (name) {
      case 'loadDraft':
        return Promise.resolve(DRAFT);
      case 'homes':
        return Promise.resolve({ homes: [], message: null });
      case 'image':
        return Promise.resolve(new Uint8Array([1]));
      case 'markup':
        return Promise.resolve(null);
      default:
        return Promise.reject(new Error(`no ${name} in the fake`));
    }
  },
} as unknown as PageChannel<NotesChannel>;

// The popup over fakes, opened on `DRAFT`, its body focused.
async function openPopup(): Promise<Harness> {
  const doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  Object.assign(doc, { addEventListener: () => undefined });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'red' }));
  const roots: HTMLElement[] = [];
  const markups: FakeMarkup[] = [];
  const logged: string[] = [];
  let body: TextEditor | null = null;
  const pushed = (): PushedScope => ({
    pop: () => undefined,
    onBaseChanged: () => undefined,
  });
  const services = {
    editor: {
      create(parent: HTMLElement, _doc: string, events: EditorEvents) {
        const editor = fakeEditor(doc, parent, events);
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
    },
    markup: fakeMarkupEditor(markups),
    toast: () => undefined,
    log: (_source: string, line: string) => logged.push(line),
    timers: { set: () => 0, clear: () => undefined },
    clock: { now: () => 0 },
    paths: posixPaths,
    homeDir: '/home/me',
    uiState: { get: () => undefined, set: () => undefined },
  } as unknown as PageServices;
  const popup = createNotePopup({
    channel,
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
    autosaveDelayMs: () => 1000,
    selectedSession: () => null,
    sessionRows: () => SESSIONS,
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
});
