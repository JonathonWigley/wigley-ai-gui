import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { DocsChannel, IndexEntry, RecentChange } from '../contract';
import type { RecentChangesInput } from '../layouts/layout';
import { loadedAgo, loadedAt } from '../loaded-time';
import type { TreeNode } from '../tree';
import type { MainFileState } from './wiki-main-source';

// The text a new `Main.md` starts with.
export const MAIN_STARTER_TEXT =
  '# Main page\n\nEach `##` heading is a sidebar shelf, each `###` heading is a label inside it, and each link is a page. Edit this file to change the sidebar.\n';

// Why the Main page is asked for: `gh` or the first show, or its file changing.
export type MainShowCause = 'picked' | 'firstShow' | 'fileChanged';

// What shows in the doc pane against `Main.md`, as a Main page open reads it.
export interface MainPageState {
  isFileOpen: boolean;
  isEmptyPageShown: boolean;
  // The pane emptied when the file was trashed from under it, and shows nothing
  // since.
  isFileTrashedFromPane: boolean;
  file: MainFileState;
}

// What opening the Main page does: a Main page matching the file stays, since a
// second open would close its editor. A file that could not be read keeps either
// page. With neither shown, `gh` opens it for the read's own toast, and any other
// cause leaves the pane as it is: only an absent file offers to be created.
export function mainOpenStep(
  { isFileOpen, isEmptyPageShown, file }: MainPageState,
  cause: MainShowCause,
): 'alreadyShows' | 'showEmptyPage' | 'openFile' | 'leavePane' {
  switch (file) {
    case 'exists':
      return isFileOpen ? 'alreadyShows' : 'openFile';
    case 'absent':
      return isEmptyPageShown ? 'alreadyShows' : 'showEmptyPage';
    case 'unreadable':
      if (isFileOpen || isEmptyPageShown) {
        return 'alreadyShows';
      }
      return cause === 'picked' ? 'openFile' : 'leavePane';
  }
}

export interface EmptyMainFocusState {
  cause: MainShowCause;
  isViewActive: boolean;
  isFilterOpen: boolean;
  isDialogOpen: boolean;
}

// The empty Main page's offer shows and takes its key only with focus on the doc.
// `gh` always takes it; a first show only on the active view with no filter box or
// dialog open.
export function emptyMainTakesFocus({
  cause,
  isViewActive,
  isFilterOpen,
  isDialogOpen,
}: EmptyMainFocusState): boolean {
  const isFirstShowFree =
    cause === 'firstShow' && isViewActive && !isFilterOpen && !isDialogOpen;
  return cause === 'picked' || isFirstShowFree;
}

export interface FirstShowState {
  // Every open and page asked of the doc pane, one in flight included.
  paneOpens: number;
  // How many of `paneOpens` a Main page open asked, a `gh` that failed included.
  mainPaneOpens: number;
  // An outside ask to open a doc, which reaches the pane only after it waits.
  isDocAsked: boolean;
  hasMainDrawn: boolean;
  // A `gh` waiting on the first reads, or a Main page open in flight.
  isMainOpening: boolean;
  file: MainFileState;
}

// A first show stays owed until a Main page draws or anything else is asked of the
// pane. It runs once a read has said what to draw, and a running Main page open
// answers first, so the two never replace each other's read.
export function isFirstShowDue({
  paneOpens,
  mainPaneOpens,
  isDocAsked,
  hasMainDrawn,
  isMainOpening,
  file,
}: FirstShowState): boolean {
  const isOtherAsked = isDocAsked || paneOpens > mainPaneOpens;
  const isOwed = !hasMainDrawn && !isOtherAsked;
  return isOwed && !isMainOpening && file !== 'unreadable';
}

// Whether a change to the file leaves the Main page shown out of step with it: a
// file that appeared under the empty page, or went from under its own page,
// whichever of the trash and the read landed first. A file that could not be read
// leaves every page as it is.
export function isMainPageStale({
  isFileOpen,
  isEmptyPageShown,
  isFileTrashedFromPane,
  file,
}: MainPageState): boolean {
  switch (file) {
    case 'exists':
      return isEmptyPageShown;
    case 'absent':
      return isFileOpen || isFileTrashedFromPane;
    case 'unreadable':
      return false;
  }
}

export interface LinkedPage {
  title: string;
  path: string;
}

// The pages the wiki's shelves link, in the tree's order: each leaf whose entry
// still exists, once per path under its first title.
export function linkedPages(
  tree: readonly TreeNode[],
  entryOf: (entryId: string) => IndexEntry | undefined,
): LinkedPage[] {
  const pages: LinkedPage[] = [];
  const seenPaths = new Set<string>();
  const pending = [...tree].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'group') {
      pending.push(...[...node.children].reverse());
    } else if (node.type === 'entry') {
      const path = entryOf(node.entryId)?.path;
      if (path !== undefined && !seenPaths.has(path)) {
        seenPaths.add(path);
        pages.push({ title: node.title, path });
      }
    }
  }
  return pages;
}

// The pages `paths` name, in `paths`' order, each once.
function pagesNamed(
  named: readonly string[],
  pages: readonly LinkedPage[],
  paths: Paths,
): LinkedPage[] {
  const found = named.flatMap(
    (path) => pages.find((page) => paths.samePath(page.path, path)) ?? [],
  );
  return [...new Set(found)];
}

// One row per commit, in the answer's order, with the links of the pages it
// touched.
export function recentRows(
  changes: readonly RecentChange[],
  pages: readonly LinkedPage[],
  now: number,
  paths: Paths,
): RecentChangesInput['rows'] {
  return changes.map((change) => ({
    sha: change.sha,
    subject: change.subject,
    time: { text: loadedAgo(change.at, now), title: loadedAt(change.at) },
    pages: pagesNamed(change.paths, pages, paths),
  }));
}

export interface RecentReaderDeps {
  channel: PageChannel<DocsChannel>;
  pages(): LinkedPage[];
  now(): number;
  paths: Paths;
  log: PluginLog;
  // Hears the rows to draw, or null for no part at all.
  show(input: RecentChangesInput | null): void;
}

// Reads the commits behind Recent changes. Only the newest ask's answer shows,
// and the rows shown stay until it lands.
export interface RecentReader {
  refresh(): void;
  // Drops an answer in flight and shows nothing.
  clear(): void;
}

export function createRecentReader(deps: RecentReaderDeps): RecentReader {
  let asked = 0;
  return {
    refresh() {
      const number = ++asked;
      const pages = deps.pages();
      void deps.channel
        .invoke(
          'recentChanges',
          pages.map((page) => page.path),
        )
        .then(
          (changes) => {
            if (number === asked) {
              deps.log(`recent changes: ${changes.length} commits`);
              deps.show({
                rows: recentRows(changes, pages, deps.now(), deps.paths),
              });
            }
          },
          (error: unknown) => {
            if (number === asked) {
              deps.log(`recent changes not read: ${errorText(error)}`);
              deps.show(null);
            }
          },
        );
    },
    clear() {
      asked++;
      deps.show(null);
    },
  };
}
