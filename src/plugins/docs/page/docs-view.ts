import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import type {
  DocsChannel,
  IndexContext,
  IndexDocument,
  IndexEntry,
  IndexLoad,
  SessionSourceSpec,
} from '../contract';
import { baseName, isInside, tildePath } from '../doc-paths';
import { isIndexedPath } from '../path-guard';
import { buildTree, type TreeLeaf } from '../tree';
import { chips, contextChoices } from './docs-state';
import { createDocView, type DocTarget } from './doc-view';
import { createTreeView } from './tree-view';

export type DocsSource =
  | { type: 'machine' }
  | { type: 'session'; spec: SessionSourceSpec };

export type DocsPaneScope = 'tree' | 'doc';

// The scopes a docs view pushes over its pane's scope.
export type DocsPushedScope = 'conflict' | 'picker' | 'box';

// What each page command does on this view.
export interface DocsViewCommands {
  treeDown(): void;
  treeUp(): void;
  treeOpen(): void;
  treeClose(): void;
  filter(): void;
  rescan(): void;
  pickContext(): void;
  focusDoc(): void;
  focusTree(): void;
  scrollDown(): void;
  scrollUp(): void;
  edit(): void;
  conflictReload(): void;
  conflictOverwrite(): void;
  conflictCancel(): void;
  pickerDown(): void;
  pickerUp(): void;
  pickerChoose(): void;
  pickerCancel(): void;
  boxComplete(): void;
  boxAccept(): void;
  boxCancel(): void;
}

export interface DocsView {
  element: HTMLElement;
  // Runs the source the first time; later calls do nothing (Docs mode's
  // build, a tab's first show).
  showFirstTime(): void;
  // Runs the source again: `R`.
  rescan(): void;
  // Returns whether the tree now shows.
  toggleTree(): boolean;
  // The scope this view's keys use now.
  focusScope(): DocsPaneScope;
  hasUnsavedEdits(): boolean;
  // Stops the view's watch and destroys its editor.
  dispose(): void;
  commands: DocsViewCommands;
}

// `setScope` and `pushScope` set and push the plugin's key scopes; the view
// sets its pane's scope only while `isActive`.
export interface DocsViewDeps {
  viewId: string;
  source: DocsSource;
  channel: PageChannel<DocsChannel>;
  homeDir: Promise<string>;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  setScope(scope: DocsPaneScope): void;
  pushScope(scope: DocsPushedScope): PushedScope;
  isActive(): boolean;
}

const SESSION_CONTEXT_TEXT =
  "A session's Docs tab uses the session's own load states";

// How each source reads its index, and the lines it shows and logs.
interface SourceRun {
  busyText: string;
  run(): Promise<IndexLoad>;
  readLine(entryCount: number): string;
  messageLine(message: string): string;
}

function sourceRun(deps: DocsViewDeps): SourceRun {
  const { channel, source } = deps;
  if (source.type === 'machine') {
    return {
      busyText: 'Rebuilding the docs index…',
      run: () => channel.invoke('rebuild'),
      readLine: (count) => `index rebuilt: ${count} entries`,
      messageLine: (message) => `index rebuild: ${message}`,
    };
  }
  return {
    busyText: "Reading this session's docs…",
    run: () => channel.invoke('sessionIndex', source.spec),
    readLine: (count) => `session index read: ${count} entries`,
    messageLine: (message) => `session index: ${message}`,
  };
}

// The plugin entry whose cache holds `path`, if any.
function cachingPlugin(
  document: IndexDocument | null,
  path: string,
): string | null {
  const entry = document?.entries.find(
    (candidate) =>
      candidate.source === 'plugin' &&
      candidate.root !== null &&
      isInside(path, candidate.root),
  );
  return entry?.plugin ?? null;
}

interface PickerRequest<T> {
  title: string;
  items: readonly T[];
  label(item: T): string;
  selected: number;
  chosen(item: T): void;
}

// A list over the view, scope `docs.picker` pushed while it shows; the base
// scope changing under it cancels it.
interface ListPicker {
  element: HTMLElement;
  open<T>(request: PickerRequest<T>): void;
  down(): void;
  up(): void;
  choose(): void;
  cancel(): void;
}

function createListPicker(pushScope: () => PushedScope, log: Log): ListPicker {
  const overlay = element('div', 'docs-overlay');
  const dialog = element('div', 'dialog docs-picker');
  const title = element('h2', 'dialog-title');
  const list = element('ol', 'docs-picker-list');
  dialog.append(title, list);
  overlay.append(dialog);
  overlay.hidden = true;

  let labels: string[] = [];
  let cursor = 0;
  let chooseAt: ((index: number) => void) | null = null;
  let pushed: PushedScope | null = null;

  const draw = () => {
    list.replaceChildren(
      ...labels.map((label, index) => {
        const item = element('li', 'docs-picker-item', label);
        item.classList.toggle('is-cursor', index === cursor);
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => {
          cursor = index;
          picker.choose();
        });
        return item;
      }),
    );
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const hide = () => {
    overlay.hidden = true;
    chooseAt = null;
    pushed?.pop();
    pushed = null;
  };

  const move = (by: 1 | -1) => {
    cursor = Math.min(Math.max(cursor + by, 0), labels.length - 1);
    draw();
  };

  const picker: ListPicker = {
    element: overlay,
    open(request) {
      if (pushed === null) {
        const scope = pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            picker.cancel();
          }
        });
        pushed = scope;
      }
      labels = request.items.map(request.label);
      cursor = Math.min(Math.max(request.selected, 0), labels.length - 1);
      chooseAt = (index) => request.chosen(request.items[index]);
      title.textContent = request.title;
      overlay.hidden = false;
      draw();
      log('docs', `picker shown: ${request.title}`);
    },
    down: () => move(1),
    up: () => move(-1),
    choose() {
      const chosen = chooseAt;
      if (chosen === null || labels.length === 0) {
        return;
      }
      const index = cursor;
      hide();
      chosen(index);
    },
    cancel() {
      if (chooseAt !== null) {
        hide();
      }
    },
  };
  return picker;
}

// One docs view over an index source: the tree pane and the doc pane, the
// context picker over them. A machine view reads the last index at creation;
// a session view reads nothing until its first show.
export function createDocsView(deps: DocsViewDeps): DocsView {
  const { log, toast } = deps;
  const run = sourceRun(deps);
  const root = element('div', 'docs-view');
  let document: IndexDocument | null = null;
  let entriesById = new Map<string, IndexEntry>();
  let contextFolder: string | null = null;
  let focused: DocsPaneScope = 'tree';
  let isTreeShown = true;
  let hasRun = false;
  // Each load's number; a load older than the one shown is dropped.
  let startedLoads = 0;
  let shownLoad = 0;

  const applyScope = () => {
    if (deps.isActive()) {
      deps.setScope(focused);
    }
  };

  const context = (): IndexContext | null => {
    if (document === null) {
      return null;
    }
    if (deps.source.type === 'session') {
      return document.contexts[0] ?? null;
    }
    return (
      document.contexts.find((each) => each.folder === contextFolder) ?? null
    );
  };

  const targetFor = (
    path: string,
    entry: IndexEntry | null,
    line: number | null,
    fragment: string | null,
  ): DocTarget => {
    const isHeaderOnly = entry?.kind === 'hook' || entry?.kind === 'plugin';
    return {
      path,
      title: entry?.title ?? baseName(path),
      entryId: entry?.id ?? null,
      isHeaderOnly,
      cachePlugin:
        entry?.kind === 'plugin' ? null : cachingPlugin(document, path),
      line,
      fragment,
    };
  };

  const tree = createTreeView({
    log,
    openLeaf: (leaf: TreeLeaf) => {
      const entry = entriesById.get(leaf.entryId);
      if (entry !== undefined) {
        void doc.open(targetFor(entry.path, entry, entry.line, null));
      }
    },
    pushBoxScope: () => deps.pushScope('box'),
    filterClosed: () => {
      focused = 'tree';
      applyScope();
    },
  });

  const doc = createDocView({
    viewId: deps.viewId,
    channel: deps.channel,
    homeDir: deps.homeDir,
    editor: deps.editor,
    markdown: deps.markdown,
    toast,
    log,
    chipsOf: (entryId) => chips(context(), entryId, false),
    followFile(path, line, fragment) {
      if (document === null || !isIndexedPath(path, document.entries)) {
        toast(`Not an indexed doc: ${path}`, 'error');
        return;
      }
      const entry =
        document.entries.find((candidate) => candidate.path === path) ?? null;
      void doc.open(targetFor(path, entry, line, fragment)).then((opened) => {
        if (opened && entry !== null) {
          tree.selectEntry(entry.id);
        }
      });
    },
    pushConflictScope: () => deps.pushScope('conflict'),
  });

  const picker = createListPicker(() => deps.pushScope('picker'), log);
  root.append(tree.element, doc.element, picker.element);

  for (const [pane, scope] of [
    [tree.element, 'tree'],
    [doc.element, 'doc'],
  ] as const) {
    pane.addEventListener('focusin', () => {
      focused = scope;
      applyScope();
    });
  }

  const showDocument = async (next: IndexDocument | null) => {
    const homeDir = await deps.homeDir;
    document = next;
    entriesById = new Map(next?.entries.map((entry) => [entry.id, entry]));
    if (next !== null && deps.source.type === 'machine') {
      const choices = contextChoices(next, homeDir);
      const kept = choices.some((choice) => choice.folder === contextFolder);
      contextFolder = kept ? contextFolder : (choices[0]?.folder ?? null);
    }
    tree.setTree(buildTree(next?.entries ?? [], homeDir), (entryId) => {
      return entriesById.get(entryId)?.path ?? '';
    });
    doc.refreshChips();
  };

  // Runs `read`, showing `busyText` while it runs, then its document and
  // message; `lines` give the line logged on its result.
  const load = (
    read: () => Promise<IndexLoad>,
    busyText: string | null,
    lines: Pick<SourceRun, 'readLine' | 'messageLine'>,
  ) => {
    const number = ++startedLoads;
    tree.setStatus(busyText);
    read()
      .then(async (result) => {
        if (number < shownLoad) {
          return;
        }
        shownLoad = number;
        await showDocument(result.document);
        log(
          'docs',
          result.message === null
            ? lines.readLine(result.document?.entries.length ?? 0)
            : lines.messageLine(result.message),
        );
        if (number === startedLoads) {
          tree.setStatus(result.message);
        }
      })
      .catch((error) => {
        log('docs', lines.messageLine(errorText(error)));
        if (number === startedLoads) {
          tree.setStatus(errorText(error));
        }
      });
  };

  const runSource = () => load(() => run.run(), run.busyText, run);

  if (deps.source.type === 'machine') {
    load(() => deps.channel.invoke('machineIndex'), null, {
      readLine: (count) => `machine index read: ${count} entries`,
      messageLine: (message) => `machine index: ${message}`,
    });
  } else {
    tree.setStatus('Not read yet');
  }

  const focusDoc = () => {
    focused = 'doc';
    doc.focus();
    applyScope();
  };

  const pickContext = () => {
    if (deps.source.type === 'session') {
      toast(SESSION_CONTEXT_TEXT, 'info');
      return;
    }
    const shown = document;
    if (shown === null) {
      return;
    }
    void deps.homeDir.then((homeDir) => {
      const choices = contextChoices(shown, homeDir);
      if (choices.length === 0) {
        return;
      }
      picker.open({
        title: 'Load states for',
        items: choices,
        label: (choice) => tildePath(choice.folder, homeDir),
        selected: choices.findIndex(
          (choice) => choice.folder === contextFolder,
        ),
        chosen: (choice) => {
          contextFolder = choice.folder;
          doc.refreshChips();
          log('docs', `context ${tildePath(choice.folder, homeDir)}`);
        },
      });
    });
  };

  const commands: DocsViewCommands = {
    treeDown: () => tree.down(),
    treeUp: () => tree.up(),
    treeOpen: () => tree.open(),
    treeClose: () => tree.close(),
    filter: () => tree.openFilter(),
    rescan: () => view.rescan(),
    pickContext,
    focusDoc: () => {
      focusDoc();
      log('docs', 'doc focused');
    },
    focusTree: () => {
      if (!isTreeShown) {
        view.toggleTree();
      }
      focused = 'tree';
      tree.focus();
      applyScope();
      log('docs', 'tree focused');
    },
    scrollDown: () => doc.scroll(1),
    scrollUp: () => doc.scroll(-1),
    edit: () => doc.edit(),
    conflictReload: () => doc.conflictReload(),
    conflictOverwrite: () => doc.conflictOverwrite(),
    conflictCancel: () => doc.conflictCancel(),
    pickerDown: () => picker.down(),
    pickerUp: () => picker.up(),
    pickerChoose: () => picker.choose(),
    pickerCancel: () => picker.cancel(),
    boxComplete: () => undefined,
    boxAccept: () => tree.acceptFilter(),
    boxCancel: () => tree.cancelFilter(),
  };

  let isDisposed = false;
  deps.channel.on('docChanged', (change) => {
    if (!isDisposed && change.viewId === deps.viewId) {
      doc.diskChanged(change.path);
    }
  });

  const view: DocsView = {
    element: root,
    showFirstTime() {
      if (!hasRun) {
        hasRun = true;
        runSource();
      }
    },
    rescan() {
      hasRun = true;
      runSource();
    },
    toggleTree() {
      isTreeShown = !isTreeShown;
      root.classList.toggle('is-tree-hidden', !isTreeShown);
      tree.element.hidden = !isTreeShown;
      if (!isTreeShown) {
        focusDoc();
      }
      return isTreeShown;
    },
    focusScope: () => focused,
    hasUnsavedEdits: () => doc.hasUnsavedEdits(),
    dispose() {
      isDisposed = true;
      picker.cancel();
      doc.dispose();
    },
    commands,
  };
  return view;
}
