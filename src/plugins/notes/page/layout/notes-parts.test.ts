import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  USER_LAYOUT as USER,
  withUser,
} from '../../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../../shared/page/test-dom';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import { notesPartsDeps } from '../notes-page-fakes';
import { createNotesParts, type NotesParts } from './notes-parts';

function container(): HTMLElement {
  return document.createElement('div');
}

// The labels of the buttons under `root`, in order.
function buttonLabels(root: HTMLElement): string[] {
  return findAll(asFake(root), 'ui-button-label').map(
    (label) => label.textContent,
  );
}

const IMAGE = {
  src: 'data:image/png;base64,',
  hasMarkup: false,
  isSelected: false,
};

const imageEntries = {
  imageAt: (position: number) =>
    position <= 2
      ? { ...IMAGE, position, alt: `Image ${position}` }
      : undefined,
  removeImageAt: () => undefined,
};

// The alt text of each thumbnail under `root`, in order.
function imageAlts(root: HTMLElement): string[] {
  return findAll(asFake(root), 'notes-image-thumbnail').map(
    (image: FakeElement) => (image as unknown as HTMLImageElement).alt,
  );
}

const failing = () => {
  throw new Error('broken');
};

describe('notes parts', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      part: 'row',
      layout: { row: failing } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => [
        parts.row(parent, { field: 'tags', label: 'Tags' }, null).element,
      ],
    },
    {
      part: 'image',
      layout: { image: failing } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => {
        parts.images(parent, { count: 2 }, imageEntries);
        return findAll(asFake(parent), 'notes-image').map(asHtml);
      },
    },
    {
      part: 'confirm',
      layout: {
        confirm: () => ({ element: document.createElement('div') }),
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => [parts.confirm(parent)],
    },
    {
      part: 'pickerRow',
      layout: { pickerRow: failing } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => [
        parts.pickerRow(
          parent,
          { picker: 'Target', label: 'repo — ~/repo' },
          null,
        ).element,
      ],
    },
  ])(
    'notesParts_PartFails_DrawsWithDefault ($part)',
    ({ part, layout, draw }) => {
      const { deps, logged } = notesPartsDeps();
      const parts = createNotesParts(deps);
      parts.setLayouts(withUser<Layout>(defaultLayout, layout));

      const roots = draw(parts, container());

      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        expect(root.dataset.layout).toBe('default');
      }
      expect(logged).toEqual([
        expect.stringMatching(`^layout ${USER} ${part} failed`),
      ]);
    },
  );

  it.each([
    {
      case: 'row without valueSlot',
      layout: {
        row(parent, input, kit) {
          const root = kit.el(parent, 'div', 'mine-row', input.label);
          kit.pickHint(root);
          return { element: root };
        },
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => {
        const row = parts.row(parent, { field: 'tags', label: 'Tags' }, null);
        expect(asFake(row.element).children.at(-1)).toBe(asFake(row.slot));
        return row.element;
      },
      read: (root: HTMLElement) =>
        asFake(root).children.map((child) => child.className),
      expected: ['notes-hint', 'notes-row-value'],
    },
    {
      case: 'images drawing none',
      layout: {
        images: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'mine-strip'),
        }),
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) =>
        parts.images(parent, { count: 2 }, imageEntries),
      read: imageAlts,
      expected: ['Image 1', 'Image 2'],
    },
    {
      case: 'images drawing only the second',
      layout: {
        images(parent, _input, kit) {
          const root = kit.el(parent, 'div', 'mine-strip');
          kit.image(root, 2);
          return { element: root };
        },
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) =>
        parts.images(parent, { count: 2 }, imageEntries),
      read: imageAlts,
      expected: ['Image 2', 'Image 1'],
    },
    {
      case: 'actions with only discard',
      layout: {
        actions(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-actions');
          kit.actionButton(root, 'discard');
          return { element: root };
        },
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => parts.actions(parent),
      read: buttonLabels,
      expected: [
        'Discard',
        'Append to follow-up',
        'Start session',
        'Add follow-up',
      ],
    },
    {
      case: 'confirm with only its text',
      layout: {
        confirm(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-confirm');
          kit.el(root, 'p', '', 'Gone for good.');
          return { element: root };
        },
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) => {
        const root = parts.confirm(parent);
        expect(asFake(root).parentNode).toBe(asFake(parent));
        return root;
      },
      read: buttonLabels,
      expected: ['Keep', 'Discard'],
    },
    {
      case: 'markupToolbar with no colourButton',
      layout: {
        markupToolbar(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-toolbar');
          kit.toolButton(root, 'pen');
          kit.colourKeys(root);
          kit.commandButton(root, 'closeMarkup');
          return { element: root };
        },
      } satisfies Layout,
      draw: (parts: NotesParts, parent: HTMLElement) =>
        parts.markupToolbar(parent, () => undefined).element,
      read: (root: HTMLElement) =>
        findAll(asFake(root), 'notes-colour').map((button) =>
          buttonLabels(asHtml(button)).join(),
        ),
      expected: ['Red', 'Yellow', 'Green', 'Blue'],
    },
  ])(
    'notesParts_PieceLeftOut_AppendsIt ($case)',
    ({ layout, draw, read, expected }) => {
      const { deps } = notesPartsDeps();
      const parts = createNotesParts(deps);
      parts.setLayouts(withUser<Layout>(defaultLayout, layout));

      const root = draw(parts, container());

      expect(root.dataset.layout).toBe(USER);
      expect(read(root)).toEqual(expected);
    },
  );

  it('notesParts_Redraw_LeavesOneAnchorPerHint', () => {
    const { deps, anchors } = notesPartsDeps();
    const parts = createNotesParts(deps);
    const shown = withUser<Layout>(defaultLayout, {
      target(parent, input, kit) {
        const root = kit.el(parent, 'span', 'mine-target', input.text ?? '');
        kit.keyHint(root, 'pickTarget');
        return { element: root };
      },
    });
    const slot = container();
    const actions = container();
    parts.setLayouts(shown);
    parts.target(slot, { text: 'repo-a' });
    parts.actions(actions);

    parts.target(slot, { text: 'repo-b' });
    parts.setLayouts(shown);
    parts.actions(actions);

    const live = anchors
      .filter((anchor) => !anchor.isDisposed)
      .map((anchor) => `${anchor.command} ${anchor.scope}`)
      .sort();
    expect(live).toEqual([
      'notes.appendFollowup notes.popup',
      'notes.discard notes.popup',
      'notes.pickTarget notes.popup',
      'notes.sendFollowup notes.popup',
      'notes.sendFollowup notes.title',
      'notes.sendSession notes.popup',
    ]);
    expect(asFake(slot).textContent).toBe('repo-b');
    expect(asFake(actions).children).toHaveLength(1);
  });

  it('notesParts_PickerRowDispose_DisposesItsAnchors', () => {
    const { deps, anchors } = notesPartsDeps();
    const parts = createNotesParts(deps);
    parts.setLayouts(
      withUser<Layout>(defaultLayout, {
        pickerRow(parent, input, kit) {
          const root = kit.el(parent, 'li', 'mine-row', input.label);
          kit.keyHint(root, 'pickerChoose');
          return { element: root };
        },
      }),
    );
    const drawn = parts.pickerRow(
      container(),
      { picker: 'Tags', label: 'Add ui' },
      null,
    );

    drawn.dispose();

    expect(
      anchors.map((anchor) => `${anchor.command} ${anchor.isDisposed}`),
    ).toEqual(['notes.pickerChoose true']);
  });

  it('notesParts_Relayout_MovesTheSameBoxes', () => {
    const { deps } = notesPartsDeps();
    const parts = createNotesParts(deps);
    const fields = container();
    const titleFrame = document.createElement('div');
    const bodyFrame = document.createElement('div');
    const drawRows = () => [
      parts.row(fields, { field: 'title', label: 'Title' }, titleFrame).slot,
      parts.row(fields, { field: 'body', label: 'Body' }, bodyFrame).slot,
    ];
    const [firstTitle, firstBody] = drawRows();

    parts.setLayouts(
      withUser<Layout>(defaultLayout, {
        row(parent, input, kit) {
          const root = kit.el(parent, 'section', 'mine-row');
          kit.valueSlot(root);
          kit.el(root, 'em', '', input.label);
          return { element: root };
        },
      }),
    );
    const [titleSlot, bodySlot] = drawRows();

    expect(titleSlot).not.toBe(firstTitle);
    expect(bodySlot).not.toBe(firstBody);
    expect(asFake(titleSlot).children).toEqual([asFake(titleFrame)]);
    expect(asFake(bodySlot).children).toEqual([asFake(bodyFrame)]);
    expect(asFake(fields).children.map((row) => row.dataset.layout)).toEqual([
      USER,
      USER,
    ]);
  });
});
