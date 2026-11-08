import type { Disposable } from '../../../contracts/disposable';
import type { PageDrops } from '../../../contracts/drops';
import type { EditorHost } from '../../../contracts/editor';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { ListPicker } from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { FocusTarget } from '../../../contracts/panes';
import type { Paths } from '../../../contracts/paths';
import type {
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { RollbackDeps } from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import { listPickerCommands } from '../../../shared/page/list-picker';
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
import { loadedLine, loadedMark } from '../loaded-time';
import { isIndexedPath } from '../path-guard';
import {
  buildTree,
  buildWikiFilterTree,
  buildWikiTree,
  findSkillEntry,
  isStarredLeafId,
  type TreeHeadingMatch,
  type TreeLeaf,
  type TreeNode,
  type TreeWikiLink,
} from '../tree';
import { parseWikiTarget } from '../wiki-main';
import {
  type DocDetail,
  type DocTarget,
  type DocView,
  createDocView,
} from './doc-view';
import { createDocsDialogs } from './docs-dialogs';
import {
  applyChange,
  changeableEntry,
  changedPaths,
  chips,
  contextChoices,
  type DocChangeRecord,
  type DocsAnchor,
  type DocsPaneScope,
  detailFields,
  fileStatuses,
  paneFocusedBy,
  provisionalEntry,
  readOnlyReason,
  reapplyChange,
  settlePending,
  statusTexts,
  treeRowStatus,
} from './docs-state';
import { createDocsParts, type DocsScope } from './layout/docs-parts';
import {
  listPageContent,
  listPlace,
  type ListTarget,
  listTargetOfPlace,
} from './list-page';
import {
  createRecentReader,
  emptyMainTakesFocus,
  isFirstShowDue,
  isMainPageStale,
  linkedPages,
  MAIN_STARTER_TEXT,
  mainOpenStep,
  type MainPageState,
  type MainShowCause,
} from './main-page';
import type { StarredDocs } from './starred-docs';
import { createTreeView, type LeafMarks } from './tree-view';
import { createWikiMainSource, type MainFileState } from './wiki-main-source';

// The scopes a docs view pushes over its pane's scope.
export type DocsPushedScope = 'conflict' | 'box' | 'confirm';

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
  toggleWikiView(): void;
  backToTree(): void;
  scrollDown(): void;
  scrollUp(): void;
  lineDown(): void;
  lineUp(): void;
  halfPageDown(): void;
  halfPageUp(): void;
  scrollTop(): void;
  scrollEnd(): void;
  edit(): void;
  editSection(): void;
  prevSection(): void;
  nextSection(): void;
  historyBack(): void;
  historyForward(): void;
  listOpen(): void;
  quitEditor(): void;
  conflictReload(): void;
  conflictOverwrite(): void;
  conflictCancel(): void;
  pickerDown(): void;
  pickerUp(): void;
  pickerTop(): void;
  pickerBottom(): void;
  pickerChoose(): void;
  pickerCancel(): void;
  pickerFilter(): void;
  pickerList(): void;
  boxComplete(): void;
  boxAccept(): void;
  boxCancel(): void;
  createByKind(): void;
  createByPath(): void;
  rename(): void;
  trash(): void;
  confirmYes(): void;
  confirmNo(): void;
  asideDown(): void;
  asideUp(): void;
  asideTop(): void;
  asideBottom(): void;
  asideOpen(): void;
  backToDoc(): void;
}

// `tree` and `doc` are the two panes; the caller places them (a side bar and
// a sheet, or a split's two sides) and the view never moves them.
export interface DocsView {
  tree: HTMLElement;
  doc: HTMLElement;
  // The first call loads the source's index, then reads its plugin-source
  // statuses, again after a fetch, and rebuilds the index when the source
  // can; later calls do nothing. Every rebuild reads the statuses again once
  // it settles. The machine view's first call also starts reading `Main.md`,
  // and each index run that lands reads it again; the first show stays owed until
  // a Main page draws or anything else is asked of the pane, and runs on a read
  // that answers once the first index run has settled; the empty Main page takes
  // focus while this view is active with no filter box or dialog open, and a Main
  // page with a file leaves it.
  showFirstTime(): void;
  // Rebuilds the source's index, then reads its statuses and reads them
  // again after a fetch, and reads `Main.md` again in the machine view: `R`.
  rescan(): void;
  // Another view made `change`. A view not shown yet does nothing; else a
  // rename or trash shows at once, the doc pane following its file, and the
  // index rebuilds, which lists a created doc.
  outsideChange(change: DocChangeRecord): void;
  // The source registered under the view's `sourceId` was replaced. A view
  // not shown yet does nothing, its first show reading the new source; else
  // the index rebuilds and the statuses are read again.
  sourceReplaced(): void;
  // Once the view's first index read has settled, opens `path` at the
  // 1-based `line` and selects its row. When that read does not list `path`
  // and a rebuild is coming (the first show's) or running, waits for that one
  // rebuild to settle, resolved or rejected, and checks again; toasts when
  // the index still does not list it.
  openDoc(path: string, line: number | null): void;
  // Once the first index read and `Main.md`'s have settled, shows the Main page,
  // unless a newer open was asked, the empty Main page taking focus; nothing in a
  // view with no wiki.
  openMain(): void;
  // Closes the filter box, the dialogs and the changed-on-disk prompt, each
  // scope they pushed popped, without moving focus: another docs view is
  // about to show, and its pane scope may equal this one's.
  closeOverlays(): void;
  // Closes the filter box, keeping its filter, its scope popped, without
  // moving focus; nothing while the box is closed.
  dismissFilter(): void;
  // The tree's container hid it: the doc pane takes focus and the doc scope,
  // unless the right column holds the keys, which keeps them.
  treeHidden(): void;
  // Whether the tree shows now: the doc pane keeps the `is-tree-hidden` class
  // while it does not, which hides the doc pane's edge prompt to the tree.
  treeShownChanged(isShown: boolean): void;
  // The tree's container opened it over the doc: the tree takes focus and
  // the tree scope.
  treeOpenedOver(): void;
  // The scope this view's keys use now.
  focusScope(): DocsPaneScope;
  // The tree takes focus and the tree scope: Docs mode's side bar entered.
  focusTree(): void;
  // Main's last pane takes focus and its scope back: the right column when it
  // held the keys last and is still in sight, else the doc pane.
  focusMain(): void;
  // The view's pane scope was set again from `focusScope`: while it is the
  // right column's and the column is in sight, the column takes the DOM focus,
  // drawing its ring; else nothing.
  focusHeldAside(): void;
  // Moves focus between the tree, the doc pane and the right column by
  // `paneFocusedBy`, with the pane's scope; its caller hands it over with each
  // pane scope it sets.
  focusTarget: FocusTarget;
  hasUnsavedEdits(): boolean;
  // The open doc's path while its editor holds unsaved edits, else null.
  unsavedPath(): string | null;
  // A new set of layouts is shown: each part whose pick changed draws again,
  // keeping the open doc, the editor, scroll, selection, filter and focus. A
  // throw from the tree, the doc pane or the dialogs skips none of the others.
  layoutsChanged(): void;
  // Closes the overlays, takes the dialogs off the window, stops the view's
  // watches, its `docChanged` listener and its following of star changes,
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
  matcher: FuzzyMatcher;
  // This view's handle on the docs plugin's one list (`createDocsPicker`).
  picker: ListPicker;
  paths: Paths;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  openExternal(url: string): Promise<void>;
  // Where the doc pane's editor registers its drop target.
  drops: Pick<PageDrops, 'addTarget'>;
  // The star set every docs view shares; each view redraws on its toggles.
  // The view that makes a change moves the set's stars with it.
  starred: StarredDocs;
  // Epoch milliseconds, for the last-loaded times and pasted files' names.
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
  // and null once the doc pane holds no file.
  openChanged(path: string | null): void;
  // Hears each doc the view opened, once it shows; a refused or failed open is
  // not told.
  docOpened(path: string): void;
  // Shows the tree when its container hides it; nothing while it shows.
  revealTree(): void;
  // Whether the tree shows now as this view's own pane, beside the doc; false
  // for a tree in a mode's side bar, which the core reaches.
  isTreeOwnPane(): boolean;
  // Hears each doc or list page opened from the tree, by a row's click, `l` or
  // Enter, and each Main page `gh` shows.
  leafOpened(): void;
  // Places a dialog element over the window, until the handle's `dispose`.
  addOverlay(element: HTMLElement): Disposable;
  // The layouts shown now, read as the view's parts are made and at each
  // `layoutsChanged`.
  layouts(): ShownLayouts<Layout>;
  // The base kit for one part draw whose keys fire in `scope`, its anchors
  // recorded by `rollback`.
  baseKit(scope: DocsScope, rollback: RollbackDeps): BaseKit;
}

const SESSION_CONTEXT_TEXT =
  "A session's Docs tab uses the session's own load states";

const SESSION_SWITCH_TEXT = "A session's Docs tab keeps its own tree";

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
// its first show. The machine source's view alone has the wiki view in its
// tree, built from `Main.md`, the Main page, with Recent changes under it, and
// the generated list pages. A change made here shows at once and its paths stay pending
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
  // Each `openDoc` or `openMain` ask's number; one that waited opens only if it
  // is still the newest.
  let askedOpens = 0;
  // What `isFirstShowDue` reads besides the doc view's own count.
  let mainPaneOpens = 0;
  let isDocAsked = false;
  let hasMainDrawn = false;
  let runningMainOpens = 0;
  // Each list place's title, set by each `openList`; every history place of a
  // list came from one.
  const listTitles = new Map<string, string>();
  // The last shelves tree `showWikiTree` built.
  let wikiTree: TreeNode[] = [];
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
  // True while a `createMain` runs, so a second `i` starts no second create.
  let isCreatingMain = false;
  // Whether the doc pane's last emptying was `Main.md` trashed from under it.
  let wasMainTrashedFromPane = false;

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

  const openedFromTree = (focusesDoc: boolean) => {
    deps.leafOpened();
    if (focusesDoc) {
      focusDocAndLog();
    }
  };

  const wikiMain = isMachine
    ? createWikiMainSource({
        viewId: deps.viewId,
        channel: deps.channel,
        log,
        changed: () => wikiMainChanged(),
        answered: () => {
          void firstRead.promise.then(showOwedMain);
        },
      })
    : null;

  const tree = createTreeView({
    log,
    matcher: deps.matcher,
    parts: newParts(),
    isMachine,
    hasWiki: isMachine,
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
      void openAndTell(targetFor(entry.path, entry, entry.line, null)).then(
        (opened) => {
          if (opened) {
            openedFromTree(focusesDoc);
          }
        },
      );
    },
    openHeading: (match: TreeHeadingMatch, focusesDoc: boolean) => {
      const entry = entriesById.get(match.entryId);
      if (entry === undefined) {
        return;
      }
      void doc
        .open(targetFor(entry.path, entry, match.line, null))
        .then((opened) => {
          if (opened) {
            openedFromTree(focusesDoc);
          }
        });
    },
    openWikiLink: (link: TreeWikiLink, focusesDoc: boolean) =>
      openWikiLink(link, focusesDoc),
    switchView: () => toggleWikiView(),
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
        time: loadedMark(lastLoaded, deps.now()),
        isStarred: deps.starred.has(leaf.entryId),
      };
    },
  });

  const isMainPath = (path: string | null): boolean => {
    const mainPath = wikiMain?.path() ?? null;
    return (
      path !== null && mainPath !== null && deps.paths.samePath(path, mainPath)
    );
  };

  const doc = createDocView({
    viewId: deps.viewId,
    openChanged: (path) => {
      deps.openChanged(path);
      if (wikiMain === null) {
        return;
      }
      if (isMainPath(path)) {
        recent.refresh();
      } else {
        recent.clear();
      }
    },
    channel: deps.channel,
    homeDir: deps.homeDir,
    editor: deps.editor,
    markdown: deps.markdown,
    paths: deps.paths,
    toast,
    log,
    openExternal: deps.openExternal,
    drops: deps.drops,
    now: deps.now,
    chipsOf: (entryId, path) => {
      const entryPath = entriesById.get(entryId)?.path ?? path;
      return chips(context(), entryId, pending.has(entryPath));
    },
    statusesOf: textsOf,
    loadedOf: (entryId) => {
      const lastLoaded = entriesById.get(entryId)?.lastLoaded ?? null;
      return lastLoaded === null ? null : loadedLine(lastLoaded, deps.now());
    },
    followFile: (path, line, fragment) => {
      void openThenFocusDoc(() => openListed(path, line, fragment));
    },
    followPlace: (path, line) => {
      const listTarget = listTargetOfPlace(path);
      if (listTarget === null) {
        void openListed(path, line, null, { isHistoryMove: true });
      } else {
        openList(listTarget, listTitles.get(path)!, { isHistoryMove: true });
      }
    },
    openListEntry: (entryId) => void openListEntry(entryId),
    createMain: () => void createMain(),
    followWikiLink: (href, title) => followWikiLink(href, title),
    asideSightLost: () => asideSightLost(),
    asideSectionOpened: () => focusDocAndLog(),
    pushConflictScope: () => deps.pushScope('conflict'),
    anchor: deps.anchor,
    parts: newParts(),
  });

  const recent = createRecentReader({
    channel: deps.channel,
    pages: () => linkedPages(wikiTree, (entryId) => entriesById.get(entryId)),
    now: deps.now,
    paths: deps.paths,
    log,
    show: (input) => doc.setRecentChanges(input),
  });

  const refreshRecentOnMain = () => {
    if (isMainPath(doc.openPath())) {
      recent.refresh();
    }
  };

  // Opens `target` and tells `docOpened` once it shows; resolves to whether it
  // did.
  const openAndTell = async (
    target: DocTarget,
    options?: Parameters<DocView['open']>[1],
  ): Promise<boolean> => {
    const opened = await doc.open(target, options);
    if (opened) {
      deps.docOpened(target.path);
    }
    return opened;
  };

  const isListed = (path: string): boolean =>
    document !== null && isIndexedPath(path, document.entries, deps.paths);

  // Opens `path` when the index lists it, selecting its entry's row; else
  // toasts that it does not. Resolves to whether it opened.
  const openListed = async (
    path: string,
    line: number | null,
    fragment: string | null,
    options?: { isHistoryMove?: boolean },
  ): Promise<boolean> => {
    if (!isListed(path)) {
      toast(`Not an indexed doc: ${path}`, 'error');
      return false;
    }
    const entry =
      document?.entries.find((candidate) =>
        deps.paths.samePath(candidate.path, path),
      ) ?? null;
    const opened = await openAndTell(
      targetFor(path, entry, line, fragment),
      options,
    );
    if (opened && entry !== null) {
      tree.selectEntry(entry.id);
    }
    return opened;
  };

  // Opens that run `openThenFocusDoc` and have not settled.
  let landingOpens = 0;

  // Runs `open`, then focuses the doc once it opened: a link's open replaced
  // the element holding focus, which fell to the body.
  const openThenFocusDoc = async (
    open: () => Promise<boolean> | boolean,
  ): Promise<void> => {
    landingOpens++;
    try {
      if (await open()) {
        focusDocAndLog();
      }
    } finally {
      landingOpens--;
    }
  };

  const restoreFocus = () => {
    if (focused === 'aside' && doc.aside.isInSight()) {
      doc.aside.focus();
    } else if (focused === 'tree') {
      tree.focus();
    } else {
      doc.focus();
    }
  };

  const focusDoc = () => {
    focused = 'doc';
    doc.focus();
    applyScope();
  };

  const focusDocAndLog = () => {
    focusDoc();
    log('doc focused');
  };

  const focusTreePane = () => {
    focused = 'tree';
    tree.focus();
    applyScope();
  };

  const focusTreePaneAndLog = () => {
    focusTreePane();
    log('tree focused');
  };

  const focusAsideAndLog = () => {
    focused = 'aside';
    doc.aside.focus();
    applyScope();
    log('right column focused');
  };

  const focusPaneAndLog: Record<DocsPaneScope, () => void> = {
    tree: focusTreePaneAndLog,
    doc: focusDocAndLog,
    aside: focusAsideAndLog,
  };

  const focusTarget: FocusTarget = {
    move(direction) {
      const next = paneFocusedBy(focused, direction, {
        isTreeOwnPane: deps.isTreeOwnPane(),
        isAsideInSight: doc.aside.isInSight(),
      });
      if (next !== null) {
        focusPaneAndLog[next]();
      }
      return next !== null;
    },
  };

  // The column left sight while it held the keys: the doc takes them, its DOM
  // focus moving only while this view is active, no pane outside the doc
  // holds the focus (the right bar may hold it), and no open that focuses the
  // doc as it lands is running.
  const asideSightLost = () => {
    if (focused !== 'aside') {
      return;
    }
    focused = 'doc';
    const active = globalThis.document.activeElement;
    const isFocusOutside =
      active !== null &&
      active !== globalThis.document.body &&
      !doc.element.contains(active);
    const isOpenLanding = landingOpens > 0;
    if (deps.isActive() && !isFocusOutside && !isOpenLanding) {
      focusDocAndLog();
    }
  };

  const openInEditor = async (entry: IndexEntry, line: number) => {
    if (await openAndTell(targetFor(entry.path, entry, line, null))) {
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
    picker: deps.picker,
    parts: newParts(),
    pushScope: (scope) => deps.pushScope(scope),
    entries: () => document?.entries ?? [],
    changed: (record, selectPath) => applyDocChange(record, selectPath),
    openInEditor,
    dialogClosed: restoreFocus,
  });
  const { picker } = dialogs;
  const overlays = dialogs.elements.map((dialog) => deps.addOverlay(dialog));

  // The right column sits inside the doc pane, so a focus landing there is
  // the column's.
  for (const [pane, scope] of [
    [tree.element, 'tree'],
    [doc.element, 'doc'],
  ] as const) {
    pane.addEventListener('focusin', (event) => {
      if (isRedrawing) {
        return;
      }
      const isInAside =
        event.target instanceof HTMLElement &&
        doc.aside.element.contains(event.target);
      focused = isInAside ? 'aside' : scope;
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
      (entryId) => entriesById.get(entryId)?.headings ?? [],
      next !== null,
    );
    showWikiTree();
    const shownPage = doc.shownPage();
    if (shownPage?.type === 'list') {
      const { place, input } = shownPage.content;
      doc.updateList(listContent(listTargetOfPlace(place)!, input.title));
    }
    doc.setEntries(next?.entries ?? []);
    doc.refreshChips();
  };

  // Rebuilds the wiki's trees. No shelves show until both the index and
  // `Main.md` have been read, so no row dangles over an empty entry list.
  const showWikiTree = () => {
    if (wikiMain === null) {
      return;
    }
    const entries = document?.entries ?? [];
    const mainPath = wikiMain.path();
    wikiTree =
      document === null || mainPath === null
        ? []
        : buildWikiTree(
            wikiMain.shelves(),
            entries,
            deps.paths.parent(mainPath),
            deps.homeDir,
            deps.paths,
          );
    tree.setWikiTree(
      wikiTree,
      buildWikiFilterTree(entries, deps.homeDir, deps.paths),
      document !== null && wikiMain.isRead(),
    );
  };

  const showAllPages = () => {
    tree.showView('all');
    log('sidebar shows All pages');
  };

  const refuseMissingPage = (title: string) => {
    toast(`Not in the docs index: ${title}`, 'info');
    log(`refused ${title}: not in the index`);
  };

  const listContent = (target: ListTarget, title: string) =>
    listPageContent(
      target,
      title,
      document?.entries ?? [],
      deps.homeDir,
      deps.now(),
      deps.paths,
    );

  const openList = (
    target: ListTarget,
    title: string,
    options?: { isHistoryMove?: boolean },
  ): boolean => {
    listTitles.set(listPlace(target), title);
    const content = listContent(target, title);
    const isShown = doc.showPage({ type: 'list', content }, options);
    if (isShown) {
      log(`listed ${title}: ${content.input.count} docs`);
    }
    return isShown;
  };

  const openWikiLink = (link: TreeWikiLink, focusesDoc: boolean) => {
    const { target } = link;
    if (link.isDangling) {
      refuseMissingPage(link.title);
    } else if (target.type === 'all') {
      showAllPages();
    } else if (target.type === 'kind' || target.type === 'owner') {
      if (openList(target, link.title)) {
        openedFromTree(focusesDoc);
      }
    }
  };

  // Resolves to whether it opened.
  const openListEntry = async (entryId: string): Promise<boolean> => {
    const entry = entriesById.get(entryId);
    if (entry === undefined) {
      return false;
    }
    const opened = await openAndTell(
      targetFor(entry.path, entry, entry.line, null),
    );
    if (opened) {
      tree.selectEntry(entry.id);
    }
    return opened;
  };

  // A `wiki:` or `wigley:` link in a rendered body acts as its sidebar row does.
  const followWikiLink = (href: string, title: string): boolean => {
    if (!isMachine) {
      return false;
    }
    const target = parseWikiTarget(href);
    switch (target?.type) {
      case 'skill': {
        const entry = findSkillEntry(target.name, document?.entries ?? []);
        if (entry === null) {
          refuseMissingPage(title);
        } else {
          void openThenFocusDoc(() => openListEntry(entry.id));
        }
        return true;
      }
      case 'kind':
      case 'owner':
        void openThenFocusDoc(() => openList(target, title));
        return true;
      case 'all':
        deps.revealTree();
        showAllPages();
        return true;
      default:
        return false;
    }
  };

  const mainPageState = (file: MainFileState): MainPageState => {
    const isPaneEmpty = doc.openPath() === null && doc.shownPage() === null;
    return {
      isFileOpen: isMainPath(doc.openPath()),
      isEmptyPageShown: doc.shownPage()?.type === 'mainEmpty',
      isFileTrashedFromPane: isPaneEmpty && wasMainTrashedFromPane,
      file,
    };
  };

  // Runs a Main page's ask of the doc view, whose rise of its count is no other ask;
  // a refused ask raises nothing.
  const askingMainPane = <T>(ask: () => T): T => {
    const before = doc.opensAsked();
    const result = ask();
    mainPaneOpens += doc.opensAsked() - before;
    return result;
  };

  const focusEmptyMain = (cause: MainShowCause) => {
    const takesFocus = emptyMainTakesFocus({
      cause,
      isViewActive: deps.isActive(),
      isFilterOpen: tree.isFilterOpen(),
      isDialogOpen: dialogs.isAnyOpen(),
    });
    if (takesFocus) {
      focusDocAndLog();
    }
  };

  // Shows `Main.md` as any doc, or the empty Main page with no file. A Main page
  // matching the file stays, and so does either page over a file that could not be
  // read; with neither page, only `gh` opens such a file.
  const showMain = (cause: MainShowCause) => {
    const path = wikiMain?.path() ?? null;
    if (wikiMain === null || path === null) {
      log('no Main page path');
      return;
    }
    const mainReady = () => {
      hasMainDrawn = true;
      log('Main page ready');
      if (cause === 'picked') {
        deps.leafOpened();
      }
    };
    switch (mainOpenStep(mainPageState(wikiMain.fileState()), cause)) {
      case 'alreadyShows':
        log('Main page already shows');
        mainReady();
        if (doc.shownPage()?.type === 'mainEmpty') {
          focusEmptyMain(cause);
        }
        return;
      case 'showEmptyPage':
        if (
          askingMainPane(() =>
            doc.showPage({
              type: 'mainEmpty',
              path: deps.paths.tilde(path, deps.homeDir),
            }),
          )
        ) {
          log('showed the empty Main page');
          mainReady();
          focusEmptyMain(cause);
        }
        return;
      case 'openFile':
        runningMainOpens++;
        void askingMainPane(() =>
          openAndTell(targetFor(path, entryAt(path), null, null)),
        )
          .then((opened) => {
            if (opened) {
              log('opened the Main page');
              mainReady();
            }
          })
          .finally(() => {
            runningMainOpens--;
          });
        return;
      case 'leavePane':
        return;
    }
  };

  const showOwedMain = () => {
    if (wikiMain === null) {
      return;
    }
    const isDue = isFirstShowDue({
      paneOpens: doc.opensAsked(),
      mainPaneOpens,
      isDocAsked,
      hasMainDrawn,
      isMainOpening: runningMainOpens > 0,
      file: wikiMain.fileState(),
    });
    if (isDue) {
      showMain('firstShow');
    }
  };

  const createMain = async () => {
    const path = wikiMain?.path() ?? null;
    if (wikiMain === null || path === null || isCreatingMain) {
      return;
    }
    isCreatingMain = true;
    try {
      const created = await deps.channel.invoke('createDoc', {
        type: 'path',
        path,
      });
      await deps.channel.invoke(
        'writeDoc',
        created.path,
        MAIN_STARTER_TEXT,
        '',
      );
      const entry = provisionalEntry(
        created.path,
        'reference',
        document?.entries ?? [],
        deps.paths,
      );
      applyDocChange({ type: 'created', entry }, null);
      await wikiMain.reread();
      await openInEditor(entry, created.line);
      log('created Main.md');
    } catch (error) {
      toast(errorText(error), 'error');
      log(`Main.md not created: ${errorText(error)}`);
    } finally {
      isCreatingMain = false;
    }
  };

  // `Main.md` read another text: its links changed, a file that appeared replaces
  // the empty Main page, and the empty page replaces a file that went from under
  // the pane, unless an editor holds unsaved edits on it. The owed first show
  // listens to `answered`, not to this.
  const wikiMainChanged = () => {
    if (wikiMain === null) {
      return;
    }
    showWikiTree();
    const isStale = isMainPageStale(mainPageState(wikiMain.fileState()));
    if (isStale && !doc.hasUnsavedEdits()) {
      showMain('fileChanged');
    }
    refreshRecentOnMain();
  };

  const toggleWikiView = () => {
    if (!isMachine) {
      toast(SESSION_SWITCH_TEXT, 'info');
      log('a session tab keeps its own tree');
      return;
    }
    deps.revealTree();
    if (tree.shownView() === 'wiki') {
      showAllPages();
    } else {
      tree.showView('wiki');
      log('sidebar shows the wiki');
    }
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
        void wikiMain?.reread();
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
        refreshRecentOnMain();
        log(resultLine(result, run));
        if (number === startedLoads) {
          tree.setStatus(result.message);
        }
        return result;
      })
      .catch((error: unknown) => {
        firstRead.resolve();
        log(`${deps.sourceId}: ${errorText(error)}`);
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
        log(`plugin status ${verb}: ${read.clones.length} clones`);
        tree.statusesChanged();
        doc.refreshChips();
      })
      .catch((error: unknown) => {
        log(`plugin status: ${errorText(error)}`);
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

  // The doc pane follows a move of its file and empties when it is trashed; the
  // read that finds `Main.md` gone then shows the empty Main page.
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
      wasMainTrashedFromPane = isMainPath(openPath);
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

  // The folder `A` starts in: the selected leaf's doc's, the selected group's,
  // or null for the home folder.
  const selectedFolder = (): string | null => {
    const node = tree.selected();
    if (node === null) {
      return null;
    }
    if (node.type === 'group') {
      return node.folder;
    }
    if (node.type !== 'entry') {
      return null;
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
        log(`context ${deps.paths.tilde(choice.folder, homeDir)}`);
      },
    });
  };

  // Stars or unstars the selected doc and logs it; nothing on a group, with
  // no row selected, or for an entry gone from the index. The wiki view
  // refuses it on every row.
  const toggleStar = () => {
    if (tree.shownView() === 'wiki') {
      toast('Stars stay in All pages', 'info');
      log('stars stay in All pages');
      return;
    }
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
    log(`${isStarred ? 'starred' : 'unstarred'} ${entry.title}`);
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
    toggleWikiView,
    backToTree: () => {
      deps.revealTree();
      focusTreePaneAndLog();
    },
    scrollDown: () => doc.scroll(1),
    scrollUp: () => doc.scroll(-1),
    lineDown: () => doc.scrollBy('line', 1),
    lineUp: () => doc.scrollBy('line', -1),
    halfPageDown: () => doc.scrollBy('halfPage', 1),
    halfPageUp: () => doc.scrollBy('halfPage', -1),
    scrollTop: () => doc.scrollToEdge('top'),
    scrollEnd: () => doc.scrollToEdge('end'),
    edit: () => doc.edit(),
    editSection: () => doc.editSection(),
    prevSection: () => doc.moveSection(-1),
    nextSection: () => doc.moveSection(1),
    historyBack: () => doc.historyBack(),
    historyForward: () => doc.historyForward(),
    listOpen: () => doc.listOpen(),
    quitEditor: () => doc.quitEditor(),
    conflictReload: () => doc.conflictReload(),
    conflictOverwrite: () => doc.conflictOverwrite(),
    conflictCancel: () => doc.conflictCancel(),
    ...listPickerCommands(picker),
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
    asideDown: () => doc.aside.move(1),
    asideUp: () => doc.aside.move(-1),
    asideTop: () => doc.aside.top(),
    asideBottom: () => doc.aside.bottom(),
    // A section row focuses the doc through `asideSectionOpened`, a linking
    // doc's open as it lands.
    asideOpen: () => {
      doc.aside.openCursor();
    },
    backToDoc: focusDocAndLog,
  };

  // A star toggle from any view redraws this one's tree, once it has read. An
  // unstar that drops the selected Starred row selects the doc's usual row.
  const starChange = deps.starred.onChanged(() => {
    if (document === null) {
      return;
    }
    const before = tree.selectedIn('all');
    showDocument(document);
    const isStarredRowDropped =
      before?.type === 'entry' &&
      isStarredLeafId(before.id) &&
      tree.selectedIn('all') === null;
    if (isStarredRowDropped) {
      tree.selectEntryIn('all', before.entryId);
    }
  });

  const listening = deps.channel.on('docChanged', (change) => {
    if (change.viewId === deps.viewId) {
      doc.diskChanged(change.path);
    }
    wikiMain?.diskChanged(change);
  });

  const view: DocsView = {
    tree: tree.element,
    doc: doc.element,
    showFirstTime() {
      if (hasRun) {
        return;
      }
      hasRun = true;
      void wikiMain?.start();
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
      void wikiMain?.reread();
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
    sourceReplaced() {
      if (hasRun) {
        void rebuild(false);
      }
    },
    openDoc(path, line) {
      const number = ++askedOpens;
      isDocAsked = true;
      void (async () => {
        await firstRead.promise;
        const awaitedRebuild = firstShowRuns ?? runningRebuild;
        if (!isListed(path) && awaitedRebuild !== null) {
          await awaitedRebuild;
          if (number !== askedOpens) {
            return;
          }
        }
        await openListed(path, line, null);
      })();
    },
    openMain() {
      if (wikiMain === null) {
        return;
      }
      const number = ++askedOpens;
      runningMainOpens++;
      void Promise.all([wikiMain.start(), firstRead.promise]).then(() => {
        runningMainOpens--;
        if (number === askedOpens) {
          showMain('picked');
        }
      });
    },
    closeOverlays() {
      tree.dismissFilter();
      dialogs.close();
      doc.closeConflict();
    },
    dismissFilter: () => tree.dismissFilter(),
    treeHidden() {
      if (focused !== 'aside') {
        focusDoc();
      }
    },
    treeShownChanged: (isShown) =>
      doc.element.classList.toggle('is-tree-hidden', !isShown),
    treeOpenedOver: focusTreePane,
    focusScope: () => focused,
    focusTree: focusTreePaneAndLog,
    focusMain() {
      if (focused === 'aside' && doc.aside.isInSight()) {
        focusAsideAndLog();
      } else {
        focusDocAndLog();
      }
    },
    focusHeldAside() {
      if (focused === 'aside' && doc.aside.isInSight()) {
        doc.aside.focus();
      }
    },
    focusTarget,
    layoutsChanged() {
      isRedrawing = true;
      try {
        callEach([tree, doc, dialogs], (part) => part.redraw());
      } finally {
        isRedrawing = false;
      }
    },
    hasUnsavedEdits: () => doc.hasUnsavedEdits(),
    unsavedPath: () => (doc.hasUnsavedEdits() ? doc.openPath() : null),
    dispose() {
      callEach<() => void>(
        [
          () => view.closeOverlays(),
          () => listening.dispose(),
          () => starChange.dispose(),
          () => wikiMain?.dispose(),
          ...overlays.map((overlay) => () => overlay.dispose()),
          () => tree.dispose(),
          () => dialogs.dispose(),
          () => doc.dispose(),
        ],
        (step) => step(),
      );
    },
    commands,
  };
  return view;
}
