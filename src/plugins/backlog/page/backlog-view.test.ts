import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ShownLayouts } from '../../../contracts/plugin';
import type { FollowupItem } from '../../../shared/followups/followup-file';
import {
  asFake,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { KeysPageExports } from '../../keys/contract';
import type { BacklogChannel, BacklogRead } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { BacklogLayout } from '../layouts/layout';
import { createBacklogView } from './backlog-view';

const ROOT = '/home/repo/docs/features';
const USER = 'mine';

interface CreatedEditor {
  parent: FakeElement;
  doc: string;
  events: EditorEvents;
  isDestroyed: boolean;
  focusOptions: unknown[];
}

interface MadeAnchor {
  command: string;
  isDisposed: boolean;
}

function item(title: string): FollowupItem {
  return {
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: '',
    line: 1,
    endLine: 1,
    done: false,
  };
}

// One repo with one home holding two follow-ups and one plan.
const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: ROOT,
      isCreateTarget: true,
      gitRoot: null,
      uncommitted: false,
      followupFiles: [
        {
          path: `${ROOT}/followups.md`,
          items: [item('First'), item('Second')],
        },
      ],
      plans: [
        {
          path: `${ROOT}/feature/plan-p/plan.md`,
          feature: 'feature',
          title: 'Plan',
          checked: 0,
          total: 0,
          target: null,
          written: null,
          tasks: [],
        },
      ],
      features: [],
    },
  ],
  message: null,
};

// Focus fires the editor's focused event, as a real editor's DOM focus does.
function fakeEditorHost() {
  const created: CreatedEditor[] = [];
  const host = {
    create(parent: HTMLElement, doc: string, events: EditorEvents) {
      const editor: CreatedEditor = {
        parent: asFake(parent),
        doc,
        events,
        isDestroyed: false,
        focusOptions: [],
      };
      created.push(editor);
      return {
        text: () => editor.doc,
        setText: () => undefined,
        focus: (options: unknown) => {
          editor.focusOptions.push(options);
          events.focused();
        },
        blur: () => events.blurred(),
        destroy: () => {
          editor.isDestroyed = true;
        },
      };
    },
  } as unknown as EditorHost;
  return { host, created };
}

// The DOM focus the view moves, which the fake DOM lacks: each element
// focused, in order.
const focusedElements: FakeElement[] = [];
const FOCUS_MEMBERS = {
  focus(this: FakeElement) {
    focusedElements.push(this);
  },
  blur() {},
  select() {},
};

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// A Backlog view, shown, over a channel that loads `READ`, with its home
// open and its first follow-up selected.
async function backlogSetup() {
  const { host, created } = fakeEditorHost();
  const anchors: MadeAnchor[] = [];
  const overlays: FakeElement[] = [];
  const keys: KeysPageExports = {
    keysFor: () => null,
    onChanged: () => ({ dispose: () => undefined }),
    anchor: (_element, command) => {
      const anchor: MadeAnchor = { command, isDisposed: false };
      anchors.push(anchor);
      return {
        dispose: () => {
          anchor.isDisposed = true;
        },
      };
    },
  };
  const channel = {
    invoke: async (method: string) => (method === 'load' ? READ : ''),
  } as unknown as PageChannel<BacklogChannel>;
  const view = createBacklogView({
    channel,
    editor: host,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    paths: { tilde: (path: string) => path } as unknown as Paths,
    homeDir: '/home',
    uiState: { get: () => undefined, set: () => undefined },
    log: () => undefined,
    toast: () => undefined,
    keys,
    platform: 'macos',
    commands: { exists: () => true, run: () => undefined },
    tags: () => ['agent-ready', 'later'],
    openDoc: () => undefined,
    setScope: () => undefined,
    pushScope: () => ({ pop: () => undefined, onBaseChanged: () => undefined }),
    addOverlay: (element) => {
      overlays.push(asFake(element));
      return { dispose: () => undefined };
    },
    run: () => undefined,
    isShown: () => true,
    revealSideBar: () => undefined,
    homePicked: () => undefined,
    homeShown: () => undefined,
  });
  const sheet = asFake(view.sheet);
  sheet.isPageRoot = true;
  view.load();
  await settle();
  view.commands.open();
  await settle();
  return { view, created, anchors, overlays, sheet };
}

function withUser(layout: BacklogLayout): ShownLayouts<BacklogLayout> {
  return {
    layouts: new Map<string, BacklogLayout>([
      ['default', defaultLayout],
      [USER, layout],
    ]),
    user: USER,
  };
}

// The live editors mounted for `field`.
function liveEditors(created: CreatedEditor[], field: string) {
  return created.filter(
    (editor) =>
      !editor.isDestroyed &&
      editor.parent.classList.contains(`backlog-editor-box--${field}`),
  );
}

// A user editor pane that mounts only the title box.
const titleOnlyEditor: BacklogLayout = {
  editor(parent, _input, kit) {
    const root = kit.el(parent, 'div', 'mine-editor');
    kit.textBox(root, 'title');
    return { element: root };
  },
};

describe('backlog view layouts', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    Object.assign(FakeElement.prototype, FOCUS_MEMBERS);
    focusedElements.length = 0;
  });
  afterEach(() => {
    for (const name of Object.keys(FOCUS_MEMBERS)) {
      delete (FakeElement.prototype as unknown as Record<string, unknown>)[
        name
      ];
    }
    vi.unstubAllGlobals();
  });

  it('a layout reload keeps the open editor draft and focused box', async () => {
    const { view, created, sheet } = await backlogSetup();
    view.commands.create();
    const [title] = liveEditors(created, 'title');
    title.events.changed('Changed title');
    title.events.modeChanged({ mode: 'insert', subMode: '' });

    view.setLayouts(withUser(titleOnlyEditor));

    const [remounted] = liveEditors(created, 'title');
    expect(remounted).not.toBe(title);
    expect(remounted.doc).toBe('Changed title');
    expect(remounted.focusOptions).toEqual([{ insertAtEnd: true }]);
    const [pane] = findAll(sheet, 'mine-editor');
    expect(pane.dataset.layout).toBe(USER);
  });

  it('a box the editor pane leaves out is appended', async () => {
    const { view, created } = await backlogSetup();
    view.setLayouts(withUser(titleOnlyEditor));

    view.commands.create();

    const mounted = ['title', 'oneLine', 'tags', 'body'].map(
      (field) => liveEditors(created, field).length,
    );
    expect(mounted).toEqual([1, 1, 1, 1]);
  });

  it('a partial layout draws its own rows and default for the rest', async () => {
    const { view, sheet } = await backlogSetup();

    view.setLayouts(
      withUser({
        followupRow(parent, input, kit) {
          const row = kit.el(parent, 'li', 'mine-row', input.title);
          kit.cursorActions(row);
          return row;
        },
      }),
    );

    const [rows] = findAll(sheet, 'backlog-rows');
    const followupRows = findAll(rows, 'mine-row');
    const planRows = rows.children.filter((row) =>
      row.classList.contains('ui-row'),
    );
    expect(followupRows.map((row) => row.dataset.layout)).toEqual([USER, USER]);
    expect(planRows.map((row) => row.dataset.layout)).toEqual(['default']);
    const [prompt] = findAll(rows, 'backlog-row-actions');
    const slot = prompt.parentNode!;
    expect(slot.parentNode).toBe(followupRows[0]);
    expect(followupRows[0].classList.contains('is-selected')).toBe(true);
  });

  it('a reload keeps the open filter text and focus', async () => {
    const { view, sheet } = await backlogSetup();
    view.commands.filter();
    const [input] = findAll(sheet, 'backlog-filter-input');
    (input as unknown as { value: string }).value = 'fir';

    view.setLayouts(
      withUser({
        list(parent, kit) {
          const root = kit.el(parent, 'div', 'mine-list');
          kit.filterBox(root);
          kit.rows(root);
          return { element: root };
        },
      }),
    );

    const [pane] = findAll(sheet, 'mine-list');
    const [moved] = findAll(pane, 'backlog-filter-input');
    expect(moved).toBe(input);
    expect((moved as unknown as { value: string }).value).toBe('fir');
    expect(focusedElements.at(-1)).toBe(input);
  });

  it.each([
    {
      case: 'the Tags picker',
      layout: {
        pickerRow(parent, input, kit) {
          return kit.row(parent, {
            density: 'list',
            tag: 'li',
            label: input.label,
            trailing: kit.trailing(),
          });
        },
      } satisfies BacklogLayout,
      open: (view: Awaited<ReturnType<typeof backlogSetup>>['view']) =>
        view.commands.pickTag(),
      check(overlays: FakeElement[]) {
        const [layer] = overlays;
        const [list] = findAll(layer, 'ui-picker-list');
        expect(layer.hidden).toBe(false);
        expect(list.children.map((row) => row.dataset.layout)).toEqual([
          USER,
          USER,
        ]);
      },
    },
    {
      case: 'the delete prompt',
      layout: {
        confirmBody(parent, input, kit) {
          const root = kit.el(parent, 'div', 'mine-body', input.body);
          kit.keepButton(root);
          return root;
        },
      } satisfies BacklogLayout,
      open: (view: Awaited<ReturnType<typeof backlogSetup>>['view']) =>
        view.commands.delete(),
      check(overlays: FakeElement[], anchors: MadeAnchor[]) {
        const deleteScrim = overlays[1];
        const [body] = findAll(deleteScrim, 'mine-body');
        const [actions] = findAll(deleteScrim, 'ui-dialog-actions');
        expect(deleteScrim.hidden).toBe(false);
        expect(body.dataset.layout).toBe(USER);
        expect(actions.textContent).toContain('Delete');
        const liveConfirms = anchors.filter(
          (anchor) =>
            anchor.command === 'backlog.confirmYes' && !anchor.isDisposed,
        );
        expect(liveConfirms.length).toBeGreaterThan(0);
      },
    },
  ])(
    '$case draws through the layout and redraws on a reload',
    async ({ layout, open, check }) => {
      const { view, overlays, anchors } = await backlogSetup();
      open(view);

      view.setLayouts(withUser(layout as BacklogLayout));

      check(overlays, anchors);
    },
  );
});
