import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  DocsChannel,
  IndexContext,
  IndexDocument,
  IndexEntry,
  IndexLoad,
  SessionSourceSpec,
} from '../contract';
import { baseName, isInside, parentFolder, tildePath } from '../doc-paths';
import { metaString } from '../index-document';
import { isIndexedPath } from '../path-guard';
import { buildTree, type TreeLeaf } from '../tree';
import { type DocDetail, type DocTarget, createDocView } from './doc-view';
import { createDocsDialogs } from './docs-dialogs';
import {
  applyChange,
  changeableEntry,
  chips,
  conflictText,
  contextChoices,
  type DocChangeRecord,
  type DocsKeysFor,
  detailFields,
  reapplyChange,
  settlePending,
} from './docs-state';
import { createTreeView } from './tree-view';

export type DocsSource =
  | { type: 'machine' }
  | { type: 'session'; spec: SessionSourceSpec };

export type DocsPaneScope = 'tree' | 'doc';

// The scopes a docs view pushes over its pane's scope.
export type DocsPushedScope = 'conflict' | 'picker' | 'box' | 'confirm';

// What each page command does on this view.
export interface DocsViewCommands {
  treeDown(): void;
  treeUp(): void;
  treeTop(): void;
  treeBottom(): void;
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
  createByKind(): void;
  createByPath(): void;
  rename(): void;
  trash(): void;
  confirmYes(): void;
  confirmNo(): void;
}

// `tree` and `doc` are the two panes; the caller places them (a side bar and
// a sheet, or a split's two sides) and the view never moves them.
export interface DocsView {
  tree: HTMLElement;
  doc: HTMLElement;
  // Runs the source the first time; later calls do nothing (Docs mode's
  // build, a tab's first show).
  showFirstTime(): void;
  // Runs the source again: `R`.
  rescan(): void;
  // Another view made `change`. A view that has read nothing yet does
  // nothing; else a rename or trash shows at once, the doc pane following its
  // file, and the source runs again, which lists a created doc.
  outsideChange(change: DocChangeRecord): void;
  // Closes the filter box, the dialogs and the changed-on-disk prompt, each
  // scope they pushed popped, without moving focus: another docs view is
  // about to show, and its pane scope may equal this one's.
  closeOverlays(): void;
  // The tree's container hid it: the doc pane takes focus and the doc scope.
  treeHidden(): void;
  // The scope this view's keys use now.
  focusScope(): DocsPaneScope;
  hasUnsavedEdits(): boolean;
  // The open doc's path while its editor holds unsaved edits, else null.
  unsavedPath(): string | null;
  // Closes the overlays, takes the dialogs off the window, stops the view's
  // watch, its `docChanged` listener and its following of keymap changes, and
  // destroys its editor.
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
  keysFor: DocsKeysFor;
  // Hears each change to the keys `keysFor` reads, until its `dispose`.
  onKeysChanged(listener: () => void): Disposable;
  setScope(scope: DocsPaneScope): void;
  pushScope(scope: DocsPushedScope): PushedScope;
  isActive(): boolean;
  // This view made `change`: every other view hears it.
  changed(change: DocChangeRecord): void;
  // Every docs view's `unsavedPath`, this one's included.
  unsavedPaths(): string[];
  // Hears the open doc's path each time a doc opens or the open one moves,
  // and null once the doc pane is emptied.
  openChanged(path: string | null): void;
  // Shows the tree when its container hides it; nothing while it shows.
  revealTree(): void;
  // Places a dialog element over the window, until the handle's `dispose`.
  addOverlay(element: HTMLElement): Disposable;
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

// The line of `text` that first holds the hook's command as JSON writes it;
// 1 when none does.
function hookLine(text: string, command: string): number {
  const written = JSON.stringify(command).slice(1, -1);
  const index = text.split('\n').findIndex((line) => line.includes(written));
  return index === -1 ? 1 : index + 1;
}

interface AppliedChange {
  seq: number;
  record: DocChangeRecord;
}

// One docs view over an index source: the tree pane and the doc pane, its
// dialogs placed over the window through `addOverlay`. A machine view reads the last index at creation; a
// session view reads nothing until its first show. A change made here shows
// at once and its paths stay pending until a source run asked after it lands;
// every other view hears it through `changed`.
export function createDocsView(deps: DocsViewDeps): DocsView {
  const { log, toast } = deps;
  const run = sourceRun(deps);
  let document: IndexDocument | null = null;
  let entriesById = new Map<string, IndexEntry>();
  // Set from the first document shown, before any entry can be opened.
  let homeDirNow = '';
  let changeSeq = 0;
  // Path → the change that made or moved it.
  let pending = new Map<string, number>();
  // The changes a landing run may predate, applied again over its document.
  let unsettled: AppliedChange[] = [];
  let contextFolder: string | null = null;
  let focused: DocsPaneScope = 'tree';
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

  const hookFile = async (entry: IndexEntry) => {
    const text = await deps.channel.invoke('readDoc', entry.path);
    const command = metaString(entry, 'command');
    const line = command === null ? 1 : hookLine(text, command);
    return { path: entry.path, text, line };
  };

  const pluginFile = async (entry: IndexEntry) => {
    const harness =
      metaString(entry, 'harness') === 'codex' ? 'codex' : 'claude';
    const found = await deps.channel.invoke(
      'pluginConfigFile',
      entry.title,
      harness,
    );
    if (found === null) {
      toast(`No config file lists ${entry.title}`, 'info');
      return null;
    }
    const text = await deps.channel.invoke('readDoc', found.path);
    return { path: found.path, text, line: found.line };
  };

  const detailOf = (entry: IndexEntry | null): DocDetail | null => {
    if (entry?.kind === 'hook') {
      const fields = detailFields(entry, homeDirNow);
      return { fields, editFile: () => hookFile(entry) };
    }
    if (entry?.kind === 'plugin') {
      const fields = detailFields(entry, homeDirNow);
      return { fields, editFile: () => pluginFile(entry) };
    }
    return null;
  };

  const targetFor = (
    path: string,
    entry: IndexEntry | null,
    line: number | null,
    fragment: string | null,
  ): DocTarget => {
    return {
      path,
      title: entry?.title ?? baseName(path),
      entryId: entry?.id ?? null,
      detail: detailOf(entry),
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
    openChanged: deps.openChanged,
    channel: deps.channel,
    homeDir: deps.homeDir,
    editor: deps.editor,
    markdown: deps.markdown,
    toast,
    log,
    chipsOf: (entryId) => {
      const path = entriesById.get(entryId)?.path;
      return chips(context(), entryId, path !== undefined && pending.has(path));
    },
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
    conflictText: () =>
      conflictText({
        reload: deps.keysFor('conflictReload', 'conflict'),
        overwrite: deps.keysFor('conflictOverwrite', 'conflict'),
        cancel: deps.keysFor('conflictCancel', 'conflict'),
      }),
  });

  const restoreFocus = () => {
    if (focused === 'doc') {
      doc.focus();
    } else {
      tree.focus();
    }
  };

  const focusDoc = () => {
    focused = 'doc';
    doc.focus();
    applyScope();
  };

  const openInEditor = async (entry: IndexEntry, line: number) => {
    if (await doc.open(targetFor(entry.path, entry, line, null))) {
      doc.edit(line);
      focusDoc();
    }
  };

  const dialogs = createDocsDialogs({
    channel: deps.channel,
    homeDir: deps.homeDir,
    toast,
    log,
    keysFor: deps.keysFor,
    pushScope: (scope) => deps.pushScope(scope),
    entries: () => document?.entries ?? [],
    changed: (record, selectPath) => applyDocChange(record, selectPath),
    openInEditor,
    dialogClosed: restoreFocus,
  });
  const { picker } = dialogs;
  // A rebind reaches the prompts that show keys while they show.
  const keysChange = deps.onKeysChanged(() => {
    doc.keysChanged();
    dialogs.keysChanged();
  });
  const overlays = dialogs.elements.map((dialog) => deps.addOverlay(dialog));

  for (const [pane, scope] of [
    [tree.element, 'tree'],
    [doc.element, 'doc'],
  ] as const) {
    pane.addEventListener('focusin', () => {
      focused = scope;
      applyScope();
    });
  }

  // The document and its entries take effect at once; the tree and chips
  // redraw once the home folder is known, unless a newer document came.
  const showDocument = async (next: IndexDocument | null) => {
    document = next;
    entriesById = new Map(next?.entries.map((entry) => [entry.id, entry]));
    const homeDir = await deps.homeDir;
    if (document !== next) {
      return;
    }
    homeDirNow = homeDir;
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
  // message; `lines` give the line logged on its result. The result covers
  // every change up to `settledSeq`; later ones apply again over it, unless
  // it already reflects them.
  const load = (
    read: () => Promise<IndexLoad>,
    busyText: string | null,
    lines: Pick<SourceRun, 'readLine' | 'messageLine'>,
    settledSeq: number,
  ) => {
    const number = ++startedLoads;
    tree.setStatus(busyText);
    read()
      .then(async (result) => {
        if (number < shownLoad) {
          return;
        }
        shownLoad = number;
        pending = settlePending(pending, settledSeq);
        unsettled = unsettled.filter((change) => change.seq > settledSeq);
        const built = result.document;
        await showDocument(
          built === null
            ? null
            : unsettled.reduce(
                (shown, change) => reapplyChange(shown, change.record),
                built,
              ),
        );
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

  const runSource = () => load(() => run.run(), run.busyText, run, changeSeq);

  if (deps.source.type === 'machine') {
    load(
      () => deps.channel.invoke('machineIndex'),
      null,
      {
        readLine: (count) => `machine index read: ${count} entries`,
        messageLine: (message) => `machine index: ${message}`,
      },
      0,
    );
  } else {
    tree.setStatus('Not read yet');
  }

  // The paths a change made or moved, read from the document it produced.
  const changedPaths = (record: DocChangeRecord, next: IndexDocument) => {
    switch (record.type) {
      case 'created':
        return [record.entry.path];
      case 'renamed':
        return next.entries
          .filter((entry) => isInside(entry.path, record.to))
          .map((entry) => entry.path);
      case 'trashed':
        return [];
    }
  };

  const entryAt = (path: string) =>
    document?.entries.find(
      (entry) => entry.path === path && entry.line === null,
    ) ?? null;

  // The doc pane follows a move of its file and empties when it is trashed.
  const followChange = (record: DocChangeRecord) => {
    const openPath = doc.openPath();
    if (openPath === null) {
      return;
    }
    if (record.type === 'renamed' && isInside(openPath, record.from)) {
      const moved = record.to + openPath.slice(record.from.length);
      doc.retarget(targetFor(moved, entryAt(moved), null, null));
    } else if (
      record.type === 'trashed' &&
      record.paths.some((path) => isInside(openPath, path))
    ) {
      doc.clear();
    }
  };

  // Applies the change to the shown document, its paths pending until a run
  // asked after it lands, and moves the doc pane with it; resolves once the
  // tree shows it, null when no document shows yet.
  const showChange = (record: DocChangeRecord): Promise<void> | null => {
    const seq = ++changeSeq;
    unsettled.push({ seq, record });
    if (document === null) {
      return null;
    }
    const next = applyChange(document, record);
    for (const path of changedPaths(record, next)) {
      pending.set(path, seq);
    }
    const shown = showDocument(next);
    followChange(record);
    return shown;
  };

  const applyDocChange = (
    record: DocChangeRecord,
    selectPath: string | null,
  ) => {
    const shown = showChange(record);
    const selectId =
      record.type === 'created'
        ? record.entry.id
        : selectPath === null
          ? null
          : entryAt(selectPath)?.id;
    void shown?.then(() => {
      if (selectId != null) {
        tree.selectEntry(selectId);
      }
    });
    runSource();
    deps.changed(record);
  };

  // The selected doc, when it is one that may be renamed or trashed; else
  // toasts why not.
  const changeable = (groupText: string): IndexEntry | null => {
    const checked = changeableEntry(
      tree.selected(),
      (entryId) => entriesById.get(entryId),
      groupText,
      deps.unsavedPaths(),
    );
    if (checked === null) {
      return null;
    }
    if ('refusal' in checked) {
      toast(checked.refusal.text, checked.refusal.tone);
      return null;
    }
    return checked.entry;
  };

  // The folder `A` starts in: the selected doc's, the selected group's, or
  // null for the home folder.
  const selectedFolder = (): string | null => {
    const node = tree.selected();
    if (node === null) {
      return null;
    }
    if (node.type === 'group') {
      return node.folder;
    }
    const entry = entriesById.get(node.entryId);
    return entry === undefined ? null : parentFolder(entry.path);
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
    treeTop: () => tree.top(),
    treeBottom: () => tree.bottom(),
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
      deps.revealTree();
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
    boxComplete: () => dialogs.boxComplete(),
    boxAccept: () =>
      dialogs.isBoxOpen() ? dialogs.boxAccept() : tree.acceptFilter(),
    boxCancel: () =>
      dialogs.isBoxOpen() ? dialogs.boxCancel() : tree.cancelFilter(),
    createByKind: () => {
      if (!doc.refuseWithUnsavedEdits()) {
        dialogs.createByKind();
      }
    },
    createByPath: () => {
      if (!doc.refuseWithUnsavedEdits()) {
        dialogs.createByPath(selectedFolder());
      }
    },
    rename: () => {
      const entry = changeable('Select a doc to rename');
      if (entry !== null) {
        dialogs.rename(entry);
      }
    },
    trash: () => {
      const entry = changeable('Select a doc to move to the Trash');
      if (entry !== null) {
        dialogs.trash(entry);
      }
    },
    confirmYes: () => dialogs.confirmYes(),
    confirmNo: () => dialogs.confirmNo(),
  };

  const listening = deps.channel.on('docChanged', (change) => {
    if (change.viewId === deps.viewId) {
      doc.diskChanged(change.path);
    }
  });

  const view: DocsView = {
    tree: tree.element,
    doc: doc.element,
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
    outsideChange(change) {
      const hasRead = hasRun || deps.source.type === 'machine';
      if (!hasRead) {
        return;
      }
      if (change.type !== 'created') {
        void showChange(change);
      }
      hasRun = true;
      runSource();
    },
    closeOverlays() {
      tree.dismissFilter();
      dialogs.close();
      doc.closeConflict();
    },
    treeHidden: focusDoc,
    focusScope: () => focused,
    hasUnsavedEdits: () => doc.hasUnsavedEdits(),
    unsavedPath: () => (doc.hasUnsavedEdits() ? doc.openPath() : null),
    dispose() {
      view.closeOverlays();
      listening.remove();
      keysChange.dispose();
      for (const overlay of overlays) {
        overlay.dispose();
      }
      doc.dispose();
    },
    commands,
  };
  return view;
}
