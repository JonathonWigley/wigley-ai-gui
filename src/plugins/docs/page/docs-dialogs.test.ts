import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import type { CommandArg, CommandId } from '../../../contracts/commands';
import type { ShownLayouts } from '../../../contracts/plugin';
import { type IndexEntry, NO_DOCS_BINDING } from '../contract';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import {
  createDocsDialogs,
  createDocsPicker,
  type DocsDialogs,
  type DocsDialogsDeps,
} from './docs-dialogs';
import { fakeDocsParts, fakePushedScope } from './docs-page-fakes';

// A layout whose picker rows and box body are marked `marker`.
function markedLayout(marker: string): Layout {
  return {
    pickerRow(parent, input, kit) {
      const row = kit.row(parent, {
        density: 'list',
        tag: 'li',
        label: input.label,
      });
      row.classList.add(marker);
      return { element: row };
    },
    boxDialog(parent, _input, kit) {
      const body = kit.el(parent, 'div', marker);
      kit.textBox(body);
      kit.completions(body);
      return { element: body };
    },
  };
}

// A layout defining only the dialog frame, its panel, body and actions row
// marked `user-frame`, `user-body` and `user-actions`.
function framedLayout(): Layout {
  return {
    dialogFrame(parent, input, kit) {
      const panel = kit.el(parent, 'div', 'user-frame');
      kit.el(panel, 'h2', 'user-title', input.title);
      const body = kit.el(panel, 'div', 'user-body');
      const actions = input.hasActions
        ? kit.el(panel, 'div', 'user-actions')
        : null;
      return { element: panel, body, actions };
    },
  };
}

const TRASHED_ENTRY = { path: '/home/a.md' } as IndexEntry;

// Lets every settled promise's chain run.
const settled = () => new Promise((resolve) => setTimeout(resolve));

// The docs dialogs over a channel listing no folder and `TRASHED_ENTRY`'s path as
// the one trash target, drawing with the layouts `layouts` returns.
// Each kit command a button runs is recorded in `runs`; `overrides` replaces
// those deps.
function dialogsOver(
  layouts: () => ShownLayouts<Layout>,
  runs: [CommandId, CommandArg | undefined][] = [],
  overrides: Partial<Record<keyof DocsDialogsDeps, unknown>> = {},
) {
  const { parts } = fakeDocsParts(layouts, (id, arg) => {
    runs.push([id, arg]);
  });
  const deps = {
    viewId: 'view:2',
    channel: {
      invoke: async (name: string) =>
        name === 'trashTargets' ? [TRASHED_ENTRY.path] : [],
    },
    homeDir: '/home',
    paths: posixPaths,
    toast: () => undefined,
    log: () => undefined,
    picker: createDocsPicker(fakeListPickerService().create()).forView('view'),
    parts,
    pushScope: fakePushedScope,
    entries: () => [],
    projectConfigFolders: () => ['.claude'],
    binding: () => NO_DOCS_BINDING,
    changed: () => undefined,
    openInEditor: async () => undefined,
    dialogClosed: () => undefined,
    ...overrides,
  } as unknown as DocsDialogsDeps;
  return createDocsDialogs(deps);
}

describe('createDocsPicker', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'another view', closer: 'other', staysOpen: true },
    { case: 'the opening view', closer: 'opener', staysOpen: false },
  ])(
    'forView_Close_ClosesOnlyTheOpeningViewsList: $case',
    ({ closer, staysOpen }) => {
      const list = fakeListPickerService().create();
      const docsPicker = createDocsPicker(list);
      docsPicker.forView('other');
      docsPicker
        .forView('opener')
        .open({ title: 'T', items: ['a'], label: String, chosen: () => {} });

      docsPicker.forView(closer).close();

      expect(list.isOpen()).toBe(staysOpen);
    },
  );
});

describe('createDocsDialogs', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createByKind_PickerRows_DrawThroughPickerRowAndRedrawOnAReload', () => {
    let shown = withUser(defaultLayout, markedLayout('row-1'));
    const dialogs = dialogsOver(() => shown);
    dialogs.createByKind();
    const list = asFake(dialogs.picker.element);
    const before = findAll(list, 'ui-row').map((row) => ({
      layout: row.dataset.layout,
      isMarked: row.classList.contains('row-1'),
    }));

    shown = withUser(defaultLayout, markedLayout('row-2'));
    dialogs.redraw();

    expect(before.length).toBeGreaterThan(0);
    expect(before).toEqual(
      before.map(() => ({ layout: USER_LAYOUT, isMarked: true })),
    );
    expect(findAll(list, 'row-1')).toEqual([]);
    expect(findAll(list, 'row-2')).toHaveLength(before.length);
    expect(dialogs.picker.isOpen()).toBe(true);
  });

  it.each<{ dialog: string; open(dialogs: DocsDialogs): void }>([
    { dialog: 'the picker', open: (dialogs) => dialogs.createByKind() },
    { dialog: 'the box', open: (dialogs) => dialogs.createByPath(null) },
    {
      dialog: 'the confirm prompt',
      open: (dialogs) => dialogs.trash(TRASHED_ENTRY),
    },
  ])('isAnyOpen_WhileShown: $dialog', async ({ open }) => {
    const dialogs = dialogsOver(() =>
      withUser(defaultLayout, markedLayout('dialog')),
    );
    expect(dialogs.isAnyOpen()).toBe(false);

    open(dialogs);
    await settled();
    const whileOpen = dialogs.isAnyOpen();
    dialogs.close();

    expect({ whileOpen, afterClose: dialogs.isAnyOpen() }).toEqual({
      whileOpen: true,
      afterClose: false,
    });
  });

  it.each([
    { label: 'Move to the Trash', answer: 'yes' },
    { label: 'Keep it', answer: 'no' },
  ])(
    'confirmDialog_AnswerClick_RunsItsCommand $answer',
    async ({ label, answer }) => {
      const runs: [CommandId, CommandArg | undefined][] = [];
      const dialogs = dialogsOver(
        () => withUser(defaultLayout, markedLayout('dialog')),
        runs,
      );
      dialogs.trash(TRASHED_ENTRY);
      await settled();
      const button = findAll(asFake(dialogs.elements[1]), 'ui-button').find(
        (each) => each.textContent?.startsWith(label),
      );

      button?.click();

      expect({ runs, isOpen: dialogs.isAnyOpen() }).toEqual({
        runs: [['docs.answerConfirm', { viewId: 'view:2', answer }]],
        isOpen: true,
      });
    },
  );

  it('redraw_ChangedFrameLayout_DrawsTheTrashConfirmInTheNewFrame', async () => {
    let shown = withUser<Layout>(defaultLayout, {});
    const dialogs = dialogsOver(() => shown);
    dialogs.trash(TRASHED_ENTRY);
    await settled();
    const scrim = asFake(dialogs.elements[1]);

    shown = withUser(defaultLayout, framedLayout());
    dialogs.redraw();

    const panels = findAll(scrim, 'user-frame');
    const body = findAll(panels[0], 'user-body')[0];
    const actions = findAll(panels[0], 'user-actions')[0];
    expect(panels).toHaveLength(1);
    expect(panels[0].dataset.layout).toBe(USER_LAYOUT);
    expect(findAll(body, 'docs-confirm-text')).toHaveLength(1);
    expect(
      findAll(actions, 'ui-button').map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining('Keep it'),
      expect.stringContaining('Move to the Trash'),
    ]);
  });

  it('redraw_ChangedFrameLayout_KeepsTheBoxInputAndCompletionsInTheNewFrame', () => {
    let shown = withUser<Layout>(defaultLayout, {});
    const dialogs = dialogsOver(() => shown);
    dialogs.createByPath(null);
    const scrim = asFake(dialogs.elements[0]);
    const input = findAll(scrim, 'docs-box')[0] as FocusFakeElement;
    input.value = 'notes';

    shown = withUser(defaultLayout, framedLayout());
    dialogs.redraw();

    const panels = findAll(scrim, 'user-frame');
    const body = findAll(panels[0], 'user-body')[0];
    expect(panels).toHaveLength(1);
    expect(findAll(body, 'docs-box')[0]).toBe(input);
    expect(input.value).toBe('notes');
    expect(findAll(body, 'docs-completion')).toHaveLength(1);
    expect(document.activeElement).toBe(input);
  });

  it('redraw_BoxOpenWithText_KeepsTheInputItsTextAndFocus', () => {
    let shown = withUser(defaultLayout, markedLayout('box-1'));
    const dialogs = dialogsOver(() => shown);
    dialogs.createByPath(null);
    const box = asFake(dialogs.elements[0]);
    const input = findAll(box, 'docs-box')[0] as FocusFakeElement;
    input.value = 'notes';

    shown = withUser(defaultLayout, markedLayout('box-2'));
    dialogs.redraw();

    expect(findAll(box, 'box-2')).toHaveLength(1);
    expect(findAll(box, 'box-1')).toEqual([]);
    expect(findAll(box, 'docs-box')[0]).toBe(input);
    expect(input.value).toBe('notes');
    expect(document.activeElement).toBe(input);
  });

  // Breaks: a continuation of a call begun before the dispose changing a
  // doc, opening the confirm, logging or toasting once it lands.
  it.each<{
    case: string;
    held: string;
    isRejected?: boolean;
    reply?: unknown;
    act(dialogs: DocsDialogs): void;
  }>([
    {
      case: 'a create by path answered',
      held: 'createDoc',
      reply: { path: '/home/new.md', line: 1 },
      act: (dialogs) => {
        dialogs.createByPath(null);
        dialogs.boxAccept();
      },
    },
    {
      case: 'a create by path refused',
      held: 'createDoc',
      isRejected: true,
      act: (dialogs) => {
        dialogs.createByPath(null);
        dialogs.boxAccept();
      },
    },
    {
      case: "a created doc's editor opened",
      held: 'openInEditor',
      act: (dialogs) => {
        dialogs.createByPath(null);
        dialogs.boxAccept();
      },
    },
    {
      case: 'a rename answered',
      held: 'renameDoc',
      reply: '/home/b.md',
      act: (dialogs) => {
        dialogs.rename(TRASHED_ENTRY);
        dialogs.boxAccept();
      },
    },
    {
      case: 'a rename refused',
      held: 'renameDoc',
      isRejected: true,
      act: (dialogs) => {
        dialogs.rename(TRASHED_ENTRY);
        dialogs.boxAccept();
      },
    },
    {
      case: 'the trash targets answered',
      held: 'trashTargets',
      reply: [TRASHED_ENTRY.path],
      act: (dialogs) => dialogs.trash(TRASHED_ENTRY),
    },
    {
      case: 'the trash targets refused',
      held: 'trashTargets',
      isRejected: true,
      act: (dialogs) => dialogs.trash(TRASHED_ENTRY),
    },
    {
      case: 'a trash answered',
      held: 'trashDoc',
      reply: { trashed: [TRASHED_ENTRY.path], error: null },
      act: (dialogs) => dialogs.trash(TRASHED_ENTRY),
    },
    {
      case: 'a trash refused',
      held: 'trashDoc',
      isRejected: true,
      act: (dialogs) => dialogs.trash(TRASHED_ENTRY),
    },
    {
      case: 'a completion listing refused',
      held: 'listFolder',
      isRejected: true,
      act: (dialogs) => dialogs.createByPath(null),
    },
  ])(
    'a call landing after the dispose changes, logs and toasts nothing ($case)',
    async ({ held, isRejected = false, reply, act }) => {
      const answer = Promise.withResolvers<unknown>();
      const heard: string[] = [];
      const dialogs = dialogsOver(
        () => withUser<Layout>(defaultLayout, {}),
        [],
        {
          channel: {
            invoke: async (name: string) => {
              if (name === held) {
                return answer.promise;
              }
              return name === 'trashTargets' ? [TRASHED_ENTRY.path] : [];
            },
          },
          toast: (text: string) => heard.push(`toast ${text}`),
          log: (line: string) => heard.push(line),
          changed: () => heard.push('changed'),
          openInEditor: () =>
            held === 'openInEditor' ? answer.promise : Promise.resolve(),
        },
      );
      act(dialogs);
      await settled();
      if (held === 'trashDoc') {
        dialogs.confirmYes();
      }

      dialogs.dispose();
      heard.length = 0;
      if (isRejected) {
        answer.reject(new Error('main stopped'));
      } else {
        answer.resolve(reply);
      }
      await settled();

      expect({ heard, isOpen: dialogs.isAnyOpen() }).toEqual({
        heard: [],
        isOpen: false,
      });
    },
  );
});
