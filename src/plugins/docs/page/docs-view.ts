import type { Disposable } from '../../../contracts/disposable';
import type { EditorHost } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Paths } from '../../../contracts/paths';
import type {
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { RollbackDeps } from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import {
  type DocsChannel,
  type IndexContext,
  type IndexDocument,
  type IndexEntry,
  MACHINE_SOURCE_ID,
  type PluginStatusRead,
  type SourceRead,
} from '../contract';
import { metaString } from '../index-document';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { loadedAgo, loadedAt, loadedLine } from '../loaded-time';
import { isIndexedPath } from '../path-guard';
import {
  buildTree,
  isStarredLeafId,
  type TreeLeaf,
  type TreeNode,
} from '../tree';
import { type DocDetail, type DocTarget, createDocView } from './doc-view';
import { createDocsDialogs } from './docs-dialogs';
import {
  applyChange,
  changeableEntry,
  changedPaths,
  chips,
  contextChoices,
  type DocChangeRecord,
  type DocsAnchor,
  detailFields,
  fileStatuses,
  readOnlyReason,
  reapplyChange,
  settlePending,
  statusTexts,
  treeRowStatus,
} from './docs-state';
import { createDocsParts, type DocsScope } from './layout/docs-parts';
import type { StarredDocs } from './starred-docs';
import { createTreeView, type LeafMarks } from './tree-view';

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
  treeToggle(): void;
  treeClose(): void;
  filter(): void;
  rescan(): void;
  pickContext(): void;
  toggleStar(): void;
  focusDoc(): void;
  focusTree(): void;
  scrollDown(): void;
  scrollUp(): void;
  lineDown(): void;
  lineUp(): void;
  halfPageDown(): void;
  halfPageUp(): void;
  edit(): void;
  quitEditor(): void;
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
  // The first call loads the source's index, then reads its plugin-source
  // statuses, again after a fetch, and rebuilds the index when the source
  // can; later calls do nothing. Every rebuild reads the statuses again once
  // it settles.
  showFirstTime(): void;
  // Rebuilds the source's index, then reads its statuses and reads them
  // again after a fetch: `R`.
  rescan(): void;
  // Another view made `change`. A view not shown yet does nothing; else a
  // rename or trash shows at once, the doc pane following its file, and the
  // index rebuilds, which lists a created doc.
  outsideChange(change: DocChangeRecord): void;
  // Once the view's first index read has settled, opens `path` at the
  // 1-based `line` and selects its row. When that read does not list `path`
  // and a rebuild is coming (the first show's) or running, waits for that one
  // rebuild to settle, resolved or rejected, and checks again; toasts when
  // the index still does not list it.
  openDoc(path: string, line: number | null): void;
  // Closes the filter box, the dialogs and the changed-on-disk prompt, each
  // scope they pushed popped, without moving focus: another docs view is
  // about to show, and its pane scope may equal this one's.
  closeOverlays(): void;
  // Closes the filter box, keeping its filter, its scope popped, without
  // moving focus; nothing while the box is closed.
  dismissFilter(): void;
  // The tree's container hid it: the doc pane takes focus and the doc scope.
  treeHidden(): void;
  // The tree's container opened it over the doc: the tree takes focus and
  // the tree scope.
  treeOpenedOver(): void;
  // The scope this view's keys use now.
  focusScope(): DocsPaneScope;
  hasUnsavedEdits(): boolean;
  // The open doc's path while its editor holds unsaved edits, else null.
  unsavedPath(): string | null;
  // A new set of layouts is shown: each part whose pick changed draws again,
  // keeping the open doc, the editor, scroll, selection, filter and focus.
  layoutsChanged(): void;
  // Closes the overlays, takes the dialogs off the window, stops the view's
  // watch, its `docChanged` listener and its following of star changes,
  // disposes its anchors, and destroys its editor.
  dispose(): void;
  commands: DocsViewCommands;
}

// `setScope` and `pushScope` set and push the plugin's key scopes; the view
// sets its pane's scope only while `isActive`. `sourceId` names the index
// source the view reads; the `machine` source's view chooses its load-state
// context, every other view shows its document's one context.
export interface DocsViewDeps {
  viewId: string;
  sourceId: string;
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  paths: Paths;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  // The star set every docs view shares; each view redraws on its toggles.
  // The view that makes a change moves the set's stars with it.
  starred: StarredDocs;
  // Epoch milliseconds, for the last-loaded times.
  now(): number;
  // Names the hints the tree, the doc pane and the dialogs show.
  anchor: DocsAnchor;
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
  // Hears each doc opened from the tree, by a leaf's click, `l` or Enter.
  leafOpened(): void;
  // Places a dialog element over the window, until the handle's `dispose`.
  addOverlay(element: HTMLElement): Disposable;
  // The layouts shown now, read at each part draw.
  layouts(): ShownLayouts<Layout>;
  // The base kit for one part draw whose keys fire in `scope`, its anchors
  // recorded by `rollback`.
  baseKit(scope: DocsScope, rollback: RollbackDeps): BaseKit;
}

const SESSION_CONTEXT_TEXT =
  "A session's Docs tab uses the session's own load states";

type IndexRun = 'loadIndex' | 'rebuildIndex';

const BUSY_TEXT: Record<IndexRun, string> = {
  loadIndex: 'Reading the docs index…',
  rebuildIndex: 'Rebuilding the docs index…',
};

// The line logged for one index run's result.
function resultLine(result: SourceRead, run: IndexRun): string {
  if (result.message !== null) {
    return `${result.title}: ${result.message}`;
  }
  const count = result.document?.entries.length ?? 0;
  const isRebuilt = run === 'rebuildIndex' && result.canRebuild;
  return `${result.title} ${isRebuilt ? 'rebuilt' : 'read'}: ${count} entries`;
}

// The plugin entry whose install folder holds `path`, if any.
function holdingPlugin(
  document: IndexDocument | null,
  path: string,
  paths: Paths,
): IndexEntry | null {
  return (
    document?.entries.find(
      (candidate) =>
        candidate.source === 'plugin' &&
        candidate.root !== null &&
        paths.isInside(path, candidate.root),
    ) ?? null
  );
}

// The local date and time an origin line shows.
function localTime(iso: string): string {
  return new Date(iso).toLocaleString();
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
// dialogs placed over the window through `addOverlay`. It reads nothing until
// its first show. A change made here shows at once and its paths stay pending
// until an index run asked after it lands; every other view hears it through
// `changed`.
export function createDocsView(deps: DocsViewDeps): DocsView {
  const { log, toast } = deps;
  const isMachine = deps.sourceId === MACHINE_SOURCE_ID;
  let document: IndexDocument | null = null;
  let entriesById = new Map<string, IndexEntry>();
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
  // Settles with the first index run, resolved or rejected.
  const firstRead = Promise.withResolvers<void>();
  // The first show's load and the rebuild it starts when the source can,
  // until both settle; null before the first show and once they settle.
  let firstShowRuns: Promise<unknown> | null = null;
  // The newest rebuild started, until it settles.
  let runningRebuild: Promise<unknown> | null = null;
  // Each `openDoc` ask's number; one that waited on a rebuild opens only if
  // it is still the newest.
  let askedOpens = 0;
  // The plugin-source statuses shown, and their files by entry id.
  let statusRead: PluginStatusRead | null = null;
  let files = fileStatuses(null);
  // Each status read's number; a reply older than the one shown is dropped.
  let startedStatusReads = 0;
  let shownStatusRead = 0;
  // Status reads asking to fetch that have not settled.
  let runningFetchReads = 0;
  // True while a layout reload redraws the panes: focus moves it makes
  // change nothing.
  let isRedrawing = false;

  // Each pane and the dialogs track their own drawn parts.
  const newParts = () =>
    createDocsParts({
      layouts: deps.layouts,
      defaultLayout,
      baseKit: deps.baseKit,
      log,
    });

  const applyScope = () => {
    if (deps.isActive()) {
      deps.setScope(focused);
    }
  };

  const context = (): IndexContext | null => {
    if (document === null) {
      return null;
    }
    if (!isMachine) {
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
      const fields = detailFields(entry, deps.homeDir, deps.paths);
      return { fields, editFile: () => hookFile(entry) };
    }
    if (entry?.kind === 'plugin') {
      const fields = detailFields(entry, deps.homeDir, deps.paths);
      return { fields, editFile: () => pluginFile(entry) };
    }
    return null;
  };

  // A plugin entry's detail view edits its config file, so it is never
  // read-only; any other doc is when its entry, or the plugin install folder
  // holding it, has a read-only reason.
  const readOnlyOf = (path: string, entry: IndexEntry | null) => {
    if (entry?.kind === 'plugin') {
      return null;
    }
    const own = entry === null ? null : readOnlyReason(entry);
    if (own !== null) {
      return own;
    }
    const holder = holdingPlugin(document, path, deps.paths);
    return holder === null ? null : readOnlyReason(holder);
  };

  // The status texts of the entry `entryId`, from the statuses shown.
  const textsOf = (entryId: string): string[] => {
    const entry = entriesById.get(entryId);
    return entry === undefined
      ? []
      : statusTexts(entry, files.get(entryId), context()?.loadedPlugins ?? {});
  };

  const targetFor = (
    path: string,
    entry: IndexEntry | null,
    line: number | null,
    fragment: string | null,
  ): DocTarget => {
    return {
      path,
      title: entry?.title ?? deps.paths.base(path),
      entryId: entry?.id ?? null,
      detail: detailOf(entry),
      readOnly: readOnlyOf(path, entry),
      line,
      fragment,
    };
  };

  const tree = createTreeView({
    log,
    parts: newParts(),
    isMachine,
    openLeaf: (leaf: TreeLeaf, focusesDoc: boolean) => {
      const entry = entriesById.get(leaf.entryId);
      if (entry === undefined) {
        return;
      }
      // Reopening the shown doc would close its editor, dropping the cursor
      // and undo history, so Enter on its row only focuses it.
      const openPath = doc.openPath();
      const isShownDoc =
        openPath !== null &&
        entry.line === null &&
        deps.paths.samePath(openPath, entry.path);
      if (focusesDoc && isShownDoc) {
        deps.leafOpened();
        focusDocAndLog();
        return;
      }
      void doc
        .open(targetFor(entry.path, entry, entry.line, null))
        .then((opened) => {
          if (!opened) {
            return;
          }
          deps.leafOpened();
          if (focusesDoc) {
            focusDocAndLog();
          }
        });
    },
    pushBoxScope: () => deps.pushScope('box'),
    filterClosed: () => {
      focused = 'tree';
      applyScope();
    },
    anchor: deps.anchor,
    rowStatus: (node: TreeNode) =>
      treeRowStatus(
        node,
        textsOf,
        files,
        statusRead?.clones ?? [],
        localTime,
        deps.paths,
      ),
    leafMarks: (leaf: TreeLeaf): LeafMarks => {
      const lastLoaded = entriesById.get(leaf.entryId)?.lastLoaded ?? null;
      return {
        time:
          lastLoaded === null
            ? null
            : {
                text: loadedAgo(lastLoaded, deps.now()),
                title: `Last loaded ${loadedAt(lastLoaded)}`,
              },
        isStarred: deps.starred.has(leaf.entryId),
      };
    },
  });

  const doc = createDocView({
    viewId: deps.viewId,
    openChanged: deps.openChanged,
    channel: deps.channel,
    homeDir: deps.homeDir,
    editor: deps.editor,
    markdown: deps.markdown,
    paths: deps.paths,
    toast,
    log,
    chipsOf: (entryId, path) => {
      const entryPath = entriesById.get(entryId)?.path ?? path;
      return chips(context(), entryId, pending.has(entryPath));
    },
    statusesOf: textsOf,
    loadedOf: (entryId) => {
      const lastLoaded = entriesById.get(entryId)?.lastLoaded ?? null;
      return lastLoaded === null ? null : loadedLine(lastLoaded, deps.now());
    },
    followFile: (path, line, fragment) => followFile(path, line, fragment),
    pushConflictScope: () => deps.pushScope('conflict'),
    anchor: deps.anchor,
    parts: newParts(),
  });

  const isListed = (path: string): boolean =>
    document !== null && isIndexedPath(path, document.entries, deps.paths);

  // Opens `path` when the index lists it, selecting its entry's row; else
  // toasts that it does not.
  const followFile = (
    path: string,
    line: number | null,
    fragment: string | null,
  ) => {
    if (!isListed(path)) {
      toast(`Not an indexed doc: ${path}`, 'error');
      return;
    }
    const entry =
      document?.entries.find((candidate) =>
        deps.paths.samePath(candidate.path, path),
      ) ?? null;
    void doc.open(targetFor(path, entry, line, fragment)).then((opened) => {
      if (opened && entry !== null) {
        tree.selectEntry(entry.id);
      }
    });
  };

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

  const focusDocAndLog = () => {
    focusDoc();
    log('docs', 'doc focused');
  };

  const focusTreePane = () => {
    focused = 'tree';
    tree.focus();
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
    paths: deps.paths,
    toast,
    log,
    parts: newParts(),
    pushScope: (scope) => deps.pushScope(scope),
    entries: () => document?.entries ?? [],
    changed: (record, selectPath) => applyDocChange(record, selectPath),
    openInEditor,
    dialogClosed: restoreFocus,
  });
  const { picker } = dialogs;
  const overlays = dialogs.elements.map((dialog) => deps.addOverlay(dialog));

  for (const [pane, scope] of [
    [tree.element, 'tree'],
    [doc.element, 'doc'],
  ] as const) {
    pane.addEventListener('focusin', () => {
      if (isRedrawing) {
        return;
      }
      focused = scope;
      applyScope();
    });
  }

  // Shows the document and its entries, redrawing the tree and chips.
  const showDocument = (next: IndexDocument | null) => {
    document = next;
    entriesById = new Map(next?.entries.map((entry) => [entry.id, entry]));
    if (next !== null && isMachine) {
      const choices = contextChoices(next, deps.homeDir, deps.paths);
      const kept = choices.some((choice) => choice.folder === contextFolder);
      contextFolder = kept ? contextFolder : (choices[0]?.folder ?? null);
    }
    tree.setTree(
      buildTree(
        next?.entries ?? [],
        deps.homeDir,
        deps.paths,
        deps.starred.ids(),
      ),
      (entryId) => {
        return entriesById.get(entryId)?.path ?? '';
      },
      next !== null,
    );
    doc.refreshChips();
  };

  // Runs `run` on the view's source, showing its busy line while it runs,
  // then its document and message, and logs the result. The result covers
  // every change made before the run was asked; later ones apply again over
  // it, unless it already reflects them. Resolves to the result, or null on a
  // rejection.
  const runIndex = (run: IndexRun): Promise<SourceRead | null> => {
    const number = ++startedLoads;
    const settledSeq = changeSeq;
    tree.setStatus(BUSY_TEXT[run]);
    return deps.channel
      .invoke(run, deps.sourceId)
      .then((result) => {
        firstRead.resolve();
        if (number < shownLoad) {
          return result;
        }
        shownLoad = number;
        pending = settlePending(pending, settledSeq);
        unsettled = unsettled.filter((change) => change.seq > settledSeq);
        const built = result.document;
        showDocument(
          built === null
            ? null
            : unsettled.reduce(
                (shown, change) =>
                  reapplyChange(shown, change.record, deps.paths),
                built,
              ),
        );
        log('docs', resultLine(result, run));
        if (number === startedLoads) {
          tree.setStatus(result.message);
        }
        return result;
      })
      .catch((error: unknown) => {
        firstRead.resolve();
        log('docs', `${deps.sourceId}: ${errorText(error)}`);
        if (number === startedLoads) {
          tree.setStatus(errorText(error));
        }
        return null;
      });
  };

  // One `pluginStatus` call, its reply shown unless a newer one was; a
  // rejection keeps the statuses shown. Resolves once it settles.
  const readStatus = (fetch: boolean): Promise<void> => {
    const number = ++startedStatusReads;
    if (fetch) {
      runningFetchReads++;
    }
    return deps.channel
      .invoke('pluginStatus', deps.sourceId, fetch)
      .then((read) => {
        if (number < shownStatusRead) {
          return;
        }
        shownStatusRead = number;
        statusRead = read;
        files = fileStatuses(read);
        const verb = fetch ? 'fetched' : 'read';
        log('docs', `plugin status ${verb}: ${read.clones.length} clones`);
        tree.statusesChanged();
        doc.refreshChips();
      })
      .catch((error: unknown) => {
        log('docs', `plugin status: ${errorText(error)}`);
      })
      .finally(() => {
        if (fetch) {
          runningFetchReads--;
        }
      });
  };

  // Reads the statuses, then, with `fetches`, reads them again after a fetch
  // once the first read settles. A read while a fetching read runs asks to
  // fetch too, joining main's running fetch, so its reply, the newer one,
  // carries what that fetch brought.
  const readStatuses = (fetches: boolean) => {
    void readStatus(runningFetchReads > 0).then(() => {
      if (fetches) {
        void readStatus(true);
      }
    });
  };

  // Only a rebuild lists a doc created since the last one. `runIndex` never
  // rejects, so a wait on `runningRebuild` always ends. Once the rebuild
  // settles the statuses are read again, fetching first with `fetches`.
  const rebuild = (fetches: boolean): Promise<SourceRead | null> => {
    const started = runIndex('rebuildIndex');
    runningRebuild = started;
    void started.then(() => {
      if (runningRebuild === started) {
        runningRebuild = null;
      }
      readStatuses(fetches);
    });
    return started;
  };

  tree.setStatus('Not read yet');

  const entryAt = (path: string) =>
    document?.entries.find(
      (entry) => deps.paths.samePath(entry.path, path) && entry.line === null,
    ) ?? null;

  // The doc pane follows a move of its file and empties when it is trashed.
  const followChange = (record: DocChangeRecord) => {
    const openPath = doc.openPath();
    if (openPath === null) {
      return;
    }
    if (record.type === 'renamed') {
      const below = deps.paths.segmentsBelow(openPath, record.from);
      if (below !== null) {
        const moved = deps.paths.join(record.to, ...below);
        doc.retarget(targetFor(moved, entryAt(moved), null, null));
      }
    } else if (
      record.type === 'trashed' &&
      record.paths.some((path) => deps.paths.isInside(openPath, path))
    ) {
      doc.clear();
    }
  };

  // Applies the change to the shown document, its paths pending until a run
  // asked after it lands, and moves the doc pane with it; false when no
  // document shows yet, a created doc pending all the same.
  const showChange = (record: DocChangeRecord): boolean => {
    const seq = ++changeSeq;
    unsettled.push({ seq, record });
    const next =
      document === null ? null : applyChange(document, record, deps.paths);
    for (const path of changedPaths(record, next, deps.paths)) {
      pending.set(path, seq);
    }
    if (next === null) {
      return false;
    }
    showDocument(next);
    followChange(record);
    return true;
  };

  // The stars move before any view draws the change, so no draw shows the
  // Starred group without them.
  const applyDocChange = (
    record: DocChangeRecord,
    selectPath: string | null,
  ) => {
    deps.starred.applyChange(record);
    const isShown = showChange(record);
    const selectId =
      record.type === 'created'
        ? record.entry.id
        : selectPath === null
          ? null
          : entryAt(selectPath)?.id;
    if (isShown && selectId != null) {
      tree.selectEntry(selectId);
    }
    void rebuild(false);
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
      deps.paths,
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
    return entry === undefined ? null : deps.paths.parent(entry.path);
  };

  const pickContext = () => {
    if (!isMachine) {
      toast(SESSION_CONTEXT_TEXT, 'info');
      return;
    }
    const shown = document;
    if (shown === null) {
      return;
    }
    const { homeDir } = deps;
    const choices = contextChoices(shown, homeDir, deps.paths);
    if (choices.length === 0) {
      return;
    }
    const title = 'Load states for';
    picker.open({
      title,
      items: choices,
      label: (choice) => deps.paths.tilde(choice.folder, homeDir),
      drawRow: dialogs.pickerRow(title),
      selected: choices.findIndex((choice) => choice.folder === contextFolder),
      chosen: (choice) => {
        contextFolder = choice.folder;
        doc.refreshChips();
        tree.statusesChanged();
        log('docs', `context ${deps.paths.tilde(choice.folder, homeDir)}`);
      },
    });
  };

  // Stars or unstars the selected doc and logs it; nothing on a group, with
  // no row selected, or for an entry gone from the index.
  const toggleStar = () => {
    const node = tree.selected();
    if (node?.type !== 'entry') {
      return;
    }
    const entry = entriesById.get(node.entryId);
    if (entry === undefined) {
      return;
    }
    deps.starred.toggle(entry.id);
    const isStarred = deps.starred.has(entry.id);
    log('docs', `${isStarred ? 'starred' : 'unstarred'} ${entry.title}`);
  };

  const commands: DocsViewCommands = {
    treeDown: () => tree.down(),
    treeUp: () => tree.up(),
    treeTop: () => tree.top(),
    treeBottom: () => tree.bottom(),
    treeOpen: () => tree.open(),
    treeToggle: () => tree.toggle(),
    treeClose: () => tree.close(),
    filter: () => tree.openFilter(),
    rescan: () => view.rescan(),
    pickContext,
    toggleStar,
    focusDoc: focusDocAndLog,
    focusTree: () => {
      deps.revealTree();
      focusTreePane();
      log('docs', 'tree focused');
    },
    scrollDown: () => doc.scroll(1),
    scrollUp: () => doc.scroll(-1),
    lineDown: () => doc.scrollBy('line', 1),
    lineUp: () => doc.scrollBy('line', -1),
    halfPageDown: () => doc.scrollBy('halfPage', 1),
    halfPageUp: () => doc.scrollBy('halfPage', -1),
    edit: () => doc.edit(),
    quitEditor: () => doc.quitEditor(),
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

  // A star toggle from any view redraws this one's tree, once it has read. An
  // unstar that drops the selected Starred row selects the doc's usual row.
  const starChange = deps.starred.onChanged(() => {
    if (document === null) {
      return;
    }
    const before = tree.selected();
    showDocument(document);
    const isStarredRowDropped =
      before?.type === 'entry' &&
      isStarredLeafId(before.id) &&
      tree.selected() === null;
    if (isStarredRowDropped) {
      tree.selectEntry(before.entryId);
    }
  });

  const listening = deps.channel.on('docChanged', (change) => {
    if (change.viewId === deps.viewId) {
      doc.diskChanged(change.path);
    }
  });

  const view: DocsView = {
    tree: tree.element,
    doc: doc.element,
    showFirstTime() {
      if (hasRun) {
        return;
      }
      hasRun = true;
      const runs = runIndex('loadIndex').then((result) => {
        readStatuses(true);
        return result?.canRebuild === true ? rebuild(false) : null;
      });
      firstShowRuns = runs;
      void runs.then(() => {
        firstShowRuns = null;
      });
    },
    rescan() {
      hasRun = true;
      void rebuild(true);
    },
    outsideChange(change) {
      if (!hasRun) {
        return;
      }
      if (change.type !== 'created') {
        showChange(change);
      }
      void rebuild(false);
    },
    openDoc(path, line) {
      const number = ++askedOpens;
      void (async () => {
        await firstRead.promise;
        const awaitedRebuild = firstShowRuns ?? runningRebuild;
        if (!isListed(path) && awaitedRebuild !== null) {
          await awaitedRebuild;
          if (number !== askedOpens) {
            return;
          }
        }
        followFile(path, line, null);
      })();
    },
    closeOverlays() {
      tree.dismissFilter();
      dialogs.close();
      doc.closeConflict();
    },
    dismissFilter: () => tree.dismissFilter(),
    treeHidden: focusDoc,
    treeOpenedOver: focusTreePane,
    focusScope: () => focused,
    layoutsChanged() {
      isRedrawing = true;
      try {
        tree.redraw();
        doc.redraw();
        dialogs.redraw();
      } finally {
        isRedrawing = false;
      }
    },
    hasUnsavedEdits: () => doc.hasUnsavedEdits(),
    unsavedPath: () => (doc.hasUnsavedEdits() ? doc.openPath() : null),
    dispose() {
      view.closeOverlays();
      listening.remove();
      starChange.dispose();
      for (const overlay of overlays) {
        overlay.dispose();
      }
      tree.dispose();
      dialogs.dispose();
      doc.dispose();
    },
    commands,
  };
  return view;
}
