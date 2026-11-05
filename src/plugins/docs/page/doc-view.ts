import type { Disposable } from '../../../contracts/disposable';
import type { DroppedFile, PageDrops } from '../../../contracts/drops';
import type {
  DocumentEditor,
  DocumentEditorEvents,
  EditorHost,
  EditorScroll,
  ScrollStep,
} from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Paths } from '../../../contracts/paths';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { scrollContent, scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { fileStamp } from '../../../shared/file-stamp';
import { element } from '../../../shared/page/dom';
import { createMarkdownMount } from '../../../shared/page/markdown-mount';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { rowAction } from '../../../shared/page/ui/row';
import type { DocsChannel, IndexEntry, IndexLink } from '../contract';
import { splitFrontmatter } from '../frontmatter';
import type { DocHeaderInput, RecentChangesInput } from '../layouts/layout';
import { linkedFrom } from '../linked-from';
import { type LinkTarget, resolveLink } from '../links';
import {
  type DocSection,
  sectionAt,
  sectionsOf,
  sectionText,
  spliceSection,
} from '../sections';
import { createDocAside } from './doc-aside';
import { createDocHistory, type DocPlace } from './doc-history';
import { docLinkOf, docLinksText, pastedImagePath } from './doc-links';
import {
  type Chip,
  codeFence,
  type DocsAnchor,
  type ReadOnlyReason,
  readOnlyText,
  topVisibleLine,
  UNSAVED_TEXT,
} from './docs-state';
import {
  hiddenBlockFlags,
  relocateSection,
  sectionMoveTarget,
} from './section-edit';
import { createListPane } from './list-pane';
import type { ListPageContent } from './list-page';
import { linkSections } from './section-links';
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DocsParts,
  type DrawnPart,
  placeAtEnds,
} from './layout/docs-parts';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';

const BANNER_TEXT = 'Changed on disk since you opened it';
const CONFLICT_TEXT = 'File changed on disk';
const EMPTY_TEXT = 'Open a doc from the tree';
const NOT_SECTIONED_TEXT = 'Only a markdown doc has sections';

// The file a detail view's `i` edits, read, and the 1-based line it opens at.
export interface DetailFile {
  path: string;
  text: string;
  line: number;
}

// A hook or plugin entry's view: a field table in place of a file, which is
// neither read nor watched until `i` edits the file `editFile` finds.
export interface DocDetail {
  fields: [string, string][];
  // Null when there is no file to edit; the finder toasts why.
  editFile(): Promise<DetailFile | null>;
}

// A page the doc pane shows with no file behind it.
export type DocPage =
  | { type: 'list'; content: ListPageContent }
  | { type: 'mainEmpty'; path: string };

// What the doc pane opens.
export interface DocTarget {
  path: string;
  title: string;
  // The entry whose chips show; null for a file no entry names.
  entryId: string | null;
  detail: DocDetail | null;
  // Why the doc is read-only; null when it may be edited.
  readOnly: ReadOnlyReason | null;
  // 1-based line of the whole file to scroll to.
  line: number | null;
  // A heading anchor to scroll to, after `line`.
  fragment: string | null;
}

export interface DocViewDeps {
  viewId: string;
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  paths: Paths;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  // Registers the scroller as a drop target while the editor is open.
  drops: Pick<PageDrops, 'addTarget'>;
  // Epoch milliseconds, for naming pasted files.
  now(): number;
  // The chips of the doc at `path` whose entry is `entryId`.
  chipsOf(entryId: string, path: string): { claude: Chip; codex: Chip };
  // The plugin-source status texts of the entry `entryId`, in chip order.
  statusesOf(entryId: string): string[];
  // The last-loaded line of the entry `entryId`; null when it was never
  // loaded or is gone.
  loadedOf(entryId: string): string | null;
  // Opens a file a link leads to in this view.
  followFile(path: string, line: number | null, fragment: string | null): void;
  // Opens a history place in another file, as a history move.
  followPlace(path: string, line: number | null): void;
  // Pushes `docs.conflict` while the changed-on-disk prompt shows.
  pushConflictScope(): PushedScope;
  anchor: DocsAnchor;
  // Draws the pane's parts through the docs layout.
  parts: DocsParts;
  // Hears the open doc's path each time a doc opens or the open one moves,
  // and null once the pane holds no file.
  openChanged(path: string | null): void;
  // Opens a list page's row.
  openListEntry(entryId: string): void;
  // Creates the Main page the empty Main page offers.
  createMain(): void;
  // Acts on a `wiki:` or `wigley:` link in the rendered body with the link's
  // text; false when it is no link this view acts on.
  followWikiLink(href: string, title: string): boolean;
}

// The doc pane, drawn by the layout's `docPane` around the app's scroller:
// in `default`, a top row while a doc or a page shows, above the scroller, holding
// the `‹ tree ⌥H` edge prompt while the tree shows, the `main` hint, and the back
// and forward edge prompts while the history has a place that way. The scroller
// holds the empty state ending in the `Esc tree` hint while no doc is open, and
// the layout's
// `pageFrame`, which stays for the view's life and places the article and the
// right column. The article holds one slot per doc part, each drawn by the
// layout: the header with its chips (load states, then plugin-source statuses,
// then the last-loaded line), the `e section` and `i edit` hints while the doc
// may be edited and no editor is open, and the read-only line; the
// changed-on-disk banner; the changed-on-disk prompt with its keys; the
// frontmatter table and the rendered body (a detail's field table), hidden
// while the document editor's frame shows on `edit`; the editor's `:q` returns
// to them. A section's editor instead opens inside the rendered body: only the
// section's blocks hide, the editor's frame and the banner and prompt slots
// take their place, the right column stays, and `:q` puts them back. Each
// top-level heading of an editable markdown doc holds an `edit` control. The
// right column, drawn by the layout's `pageAside`, holds On this page, the
// headings of the text the body shows, and Linked from, the docs among the
// entries that link to this one; it hides for a detail, for a file that is not
// markdown and for a doc with neither section. While the editor is open, files
// dropped or pasted on the scroller go in at its cursor as markdown links
// relative to the doc, a pasted file saved first under `images/` beside the
// doc. Opening another doc is refused while the editor holds unsaved edits.
// `open` resolves to whether the doc opened. The body's section references the
// index lists draw as links, and the pane keeps one history of the places shown:
// each open but a detail's, and each move by a link or an On this page row,
// records, a `Ctrl+h` or `Ctrl+l` move does not, and `historyBack` and
// `historyForward` move through them. A page with no file (a generated list page,
// or the empty Main page) draws in the same frame in place of a doc: `openPath`
// is null while one shows, and a list page is a history place. Recent changes
// draws under the rendered body whenever its input is set, and hides with the
// body under the whole-file editor.
export interface DocView {
  element: HTMLElement;
  // `isHistoryMove` records no place, for an open the history itself asked for.
  open(
    target: DocTarget,
    options?: { isHistoryMove?: boolean },
  ): Promise<boolean>;
  openPath(): string | null;
  // Replaces the doc or page shown with `page`, closing a clean editor; false
  // while unsaved edits refuse. `isHistoryMove` records no place.
  showPage(page: DocPage, options?: { isHistoryMove?: boolean }): boolean;
  // Draws the shown list's new content at the scroll it had, recording no place;
  // nothing while no list shows.
  updateList(content: ListPageContent): void;
  shownPage(): DocPage | null;
  // True until any open or page is asked, one in flight included.
  isBlank(): boolean;
  // Draws Recent changes under the body, or removes it on null.
  setRecentChanges(input: RecentChangesInput | null): void;
  // Opens the list's cursor row; on any other page, clicks the focused link or
  // button in the pane, since the bind takes Enter from the browser.
  listOpen(): void;
  // The open doc's file moved: the pane, its editor included, follows it to
  // `target`, watching the new path. The right column, the `edit` controls and
  // the header draw for it at once, and the body once it renders; a detail keeps
  // its field table, and an open editor's body waits for it to close. An open
  // editor's frame keeps the name and path it opened with, since the editor never
  // moves while open.
  retarget(target: DocTarget): void;
  // Empties the pane, its editor dropped and its watch stopped; a page stays.
  clear(): void;
  refreshChips(): void;
  // Holds the index's entries and draws the right column again, the body when
  // the shown doc's section links changed and no editor is open, and the header
  // when the index's title for the shown doc changed.
  setEntries(entries: readonly IndexEntry[]): void;
  diskChanged(path: string): void;
  // Opens the editor at `line`, else at the top visible line. On the empty Main
  // page it creates the page instead.
  edit(line?: number): void;
  // Opens the section at the top of sight in the editor, or the whole file
  // when no section holds that line; only focuses an editor already open.
  editSection(): void;
  // Scrolls to the next or previous heading in the file's order, logging where
  // it landed or why it stayed.
  moveSection(direction: 1 | -1): void;
  // Closes the open editor as `:q` does, refusing while it holds unsaved
  // edits; nothing while no editor is open.
  quitEditor(): void;
  // Move to the earlier or later history place, closing a clean editor and
  // refusing while it holds unsaved edits, the history's position unmoved.
  historyBack(): void;
  historyForward(): void;
  // Scrolls the pane a line, logging nothing; moves the cursor on a list page.
  scroll(by: 1 | -1): void;
  // Scrolls the open editor by `step`, else the pane, and logs how far it
  // moved; for the editor, once its scroll has settled, also the line at the
  // top of sight after a line scroll and whether the cursor moved.
  scrollBy(step: ScrollStep, direction: 1 | -1): void;
  // Focuses the open editor, else the pane.
  focus(): void;
  hasUnsavedEdits(): boolean;
  // Toasts and logs the refusal when the editor holds unsaved edits.
  refuseWithUnsavedEdits(): boolean;
  conflictReload(): void;
  conflictOverwrite(): void;
  conflictCancel(): void;
  // Ends the changed-on-disk prompt, if it shows, without moving focus.
  closeConflict(): void;
  // Draws the pane's parts again when a layout pick changed for one of them,
  // keeping the scroll of the pane and the right column, and the focus. While
  // the editor is open the pane's frame, the page frame and the editor's frame
  // stay, and the first two draw again once the editor closes; a section's
  // editor keeps the body part too, which also draws then.
  redraw(): void;
  // Ends the prompt, destroys the editor and its drop target, stops the watch
  // and disposes the pane's anchors, drawn parts and fence views, a throw not
  // skipping the rest. Work in flight draws nothing once it answers.
  dispose(): void;
}

// `liveFences` is false for a file shown as its source, so a fence that runs
// its source stays code.
interface Rendered {
  fields: [string, string][];
  html: string;
  bodyStartLine: number;
  liveFences: boolean;
}

interface ShownDoc {
  target: DocTarget;
  // The file the text, the editor, writes and the watch act on: the
  // target's, or the file a detail view edits.
  filePath: string;
  name: string;
  // The file text the view last read or wrote.
  text: string;
  bodyStartLine: number;
}

type AfterWrite = 'stay' | 'close';

// The open editor's section, null while it edits the whole file.
interface EditingSection {
  // The file text as the editor opened, which `section`'s lines count in. Every
  // `:w` splices into it, so a write replaces all the last write put there,
  // however many lines that was.
  openedText: string;
  section: DocSection;
  // The section's text as last read or written.
  savedText: string;
  // The direct children of the body hidden for this edit.
  hidden: HTMLElement[];
}

// A `Ctrl+h` or `Ctrl+l` move's heading, which holds while the pane stays at
// the scroll the move left it at: the last headings cannot reach the top of
// sight, so the scroll alone would not say which one the move landed on.
interface HeldSection {
  line: number;
  scrollTop: number;
}

// One heading's `edit` control and the slot it draws into.
interface SectionControl {
  part: DrawnPart;
  slot: HTMLElement;
}

interface Conflict {
  diskText: string;
  after: AfterWrite;
  scope: PushedScope;
}

// A markdown file renders its body under its frontmatter; any other file
// renders as one fenced block in its extension's language, with live fences
// off.
async function renderText(
  markdown: MarkdownRenderer,
  path: string,
  text: string,
  paths: Paths,
): Promise<Rendered> {
  if (path.endsWith('.md')) {
    const split = splitFrontmatter(text);
    const html = await markdown.document(split.body);
    return {
      fields: split.fields,
      html,
      bodyStartLine: split.bodyStartLine,
      liveFences: true,
    };
  }
  const name = paths.base(path);
  const dot = name.lastIndexOf('.');
  const language = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  const fence = codeFence(text);
  const html = await markdown.document(
    `${fence}${language}\n${text}\n${fence}`,
  );
  return { fields: [], html, bodyStartLine: 1, liveFences: false };
}

function detailRendered(detail: DocDetail): Rendered {
  return {
    fields: detail.fields,
    html: '',
    bodyStartLine: 1,
    liveFences: true,
  };
}

// The log text for an editor scroll: what `scrollText` says, the line at the
// top of sight after a line scroll that moved, and whether the cursor moved.
function editorScrollText(
  name: string,
  step: ScrollStep,
  direction: 1 | -1,
  scroll: EditorScroll,
): string {
  const scrolled = scrollText(`the editor on ${name}`, step, direction, scroll);
  const isLineScroll = step === 'line' && scroll.moved;
  const top = isLineScroll
    ? `, line ${scroll.top.line}${scroll.top.cut ? ' cut' : ''} at the top`
    : '';
  const cursor = scroll.cursorMoved ? 'moved' : 'stayed';
  return `${scrolled}${top}; the cursor ${cursor}`;
}

// A block's top in the scroller's content, measured from the scroller, so a
// positioned wrapper a layout draws around it does not change it. Rounded,
// as the browser rounds `scrollTop`: a block at a fractional top a scroll
// reached counts as at the top of sight.
function topIn(scroller: HTMLElement, block: HTMLElement): number {
  return Math.round(
    block.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop,
  );
}

// The rendered blocks' source lines and tops, measured from the scroller,
// without the blocks inside `hidden`.
function sourceBlocks(
  body: HTMLElement,
  scroller: HTMLElement,
  hidden: readonly HTMLElement[] = [],
): { line: number; top: number }[] {
  return [...body.querySelectorAll<HTMLElement>('[data-source-line]')]
    .filter((block) => !hidden.some((child) => child.contains(block)))
    .map((block) => ({
      line: Number(block.dataset.sourceLine),
      top: topIn(scroller, block),
    }));
}

// A rendered block's source line, counted from the body's first line; null
// when it has none.
function sourceLineOf(block: HTMLElement): number | null {
  const { sourceLine } = block.dataset;
  return sourceLine === undefined ? null : Number(sourceLine);
}

// `text.split` counts a last empty line, which `spliceSection` writes.
function lineCount(text: string): number {
  return text.split('\n').length;
}

// A slot one doc part draws into; it adds no box of its own.
function partSlot(): HTMLElement {
  return element('div', 'docs-slot');
}

// Whether `doc` shows a markdown file: a detail shows none, whatever its path.
// Only such a doc has sections, section links and a right column.
function isMarkdownDoc(doc: ShownDoc | null): doc is ShownDoc {
  return (
    doc !== null && doc.target.detail === null && doc.filePath.endsWith('.md')
  );
}

export function createDocView(deps: DocViewDeps): DocView {
  const { parts } = deps;
  const root = element('div', 'docs-doc-pane');
  // The scroller: it holds the empty state and the page frame, scrolls, and
  // takes focus.
  const pane = element('div', 'docs-doc');
  pane.tabIndex = -1;
  // The anchors the `i edit` and `e section` hints name, for the view's life.
  const anchors: Disposable[] = [];
  const editHint = element('span');
  anchors.push(deps.anchor(editHint, 'edit', { scope: 'doc', label: 'edit' }));
  const sectionHint = element('span');
  anchors.push(
    deps.anchor(sectionHint, 'editSection', { scope: 'doc', label: 'section' }),
  );
  // The empty Main page's offer, for the view's life: `i` is its key.
  const mainHint = element('span', 'docs-main-hint');
  anchors.push(
    deps.anchor(mainHint, 'edit', { scope: 'doc', label: 'create it' }),
  );
  rowAction(mainHint, () => deps.createMain());
  const emptySlot = partSlot();
  const frameSlot = partSlot();
  const headerSlot = partSlot();
  const bannerSlot = partSlot();
  const promptSlot = partSlot();
  const bodySlot = partSlot();
  const recentSlot = element('div', 'docs-slot docs-recent-slot');
  const pageSlot = element('div', 'docs-slot docs-page-slot');
  const editorSlot = partSlot();
  pane.append(emptySlot, frameSlot);
  const article = element('div', 'docs-article');
  article.append(
    headerSlot,
    bannerSlot,
    promptSlot,
    bodySlot,
    recentSlot,
    pageSlot,
    editorSlot,
  );
  const aside = createDocAside({
    parts,
    paths: deps.paths,
    homeDir: deps.homeDir,
    log: deps.log,
    moveToLine: (line) => moveWithinDoc(line, null),
    followLink: (path, line) => deps.followFile(path, line, null),
  });
  const body = element('div', 'md docs-body');
  const bodyMount = createMarkdownMount(deps.markdown, deps.log);
  body.addEventListener('click', followLink);
  const editorBox = element('div', 'docs-editor');
  const listPane = createListPane({
    slot: pageSlot,
    parts,
    openEntry: (entryId) => deps.openListEntry(entryId),
  });
  pane.addEventListener('focusin', () => listPane.setFocused(true));
  pane.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    const isLeavingPane = !(next instanceof Node && pane.contains(next));
    if (isLeavingPane) {
      listPane.setFocused(false);
    }
  });

  let drawnPane: DrawnPart | null = null;
  let drawnFrame: DrawnPart | null = null;
  let drawnEmpty: DrawnPart | null = null;
  let drawnHeader: DrawnPart | null = null;
  let drawnBanner: DrawnPart | null = null;
  let drawnPrompt: DrawnPart | null = null;
  let drawnBody: DrawnPart | null = null;
  let drawnEditorFrame: DrawnPart | null = null;
  let drawnMainEmpty: DrawnPart | null = null;
  let drawnRecent: DrawnPart | null = null;
  let recentInput: RecentChangesInput | null = null;
  // The fields the body part shows with the rendered body.
  let bodyFields: [string, string][] = [];
  // A layout reload while the editor was open left the pane's frame and the
  // page frame to draw once the editor closes.
  let isPaneRedrawDeferred = false;
  // A layout reload while a section edited left the body part to draw once the
  // editor closes, since the body holds the editor.
  let isBodyRedrawDeferred = false;
  // The pane's scroll as the editor opened, set back once it closes.
  let scrollTopBeforeEdit = 0;

  let shown: ShownDoc | null = null;
  // The page with no file shown; never set while `shown` is.
  let page: DocPage | null = null;
  // The index's entries, which Linked from and the section links read.
  let entries: readonly IndexEntry[] = [];
  // The JSON of the section links the body drew with.
  let appliedLinks = '[]';
  const history = createDocHistory();
  // The sections of the text the rendered body shows.
  let shownSections: DocSection[] = [];
  let sectionControls: SectionControl[] = [];
  let heldSection: HeldSection | null = null;
  let editor: DocumentEditor | null = null;
  let editingSection: EditingSection | null = null;
  // The scroller's drop target, registered while the editor is open.
  let dropTarget: Disposable | null = null;
  // The stamp the last pasted file was named by, and the index the next
  // pasted file under that stamp takes.
  let pasteStamp = '';
  let nextPasteIndex = 0;
  let conflict: Conflict | null = null;
  // The text a write in flight sends: the watch it fires is the view's own.
  let writingText: string | null = null;
  let openCount = 0;
  let isDisposed = false;

  const drawPane = () => {
    drawnPane?.dispose();
    let placing: AppSlot[] = [];
    drawnPane = parts.draw('docPane', root, {}, (kit, slotFor) => {
      const scroller = slotFor(pane, 'scroller');
      placing = [scroller];
      return { ...kit, scroller: scroller.place };
    });
    for (const part of placing) {
      part.placeIfLeftOut(drawnPane.element);
    }
  };

  const drawFrame = () => {
    drawnFrame?.dispose();
    let placing: AppSlot[] = [];
    drawnFrame = parts.draw('pageFrame', frameSlot, {}, (kit, slotFor) => {
      const placedArticle = slotFor(article, 'article');
      const placedAside = slotFor(aside.element, 'aside');
      placing = [placedArticle, placedAside];
      return { ...kit, article: placedArticle.place, aside: placedAside.place };
    });
    placeAtEnds(placing, drawnFrame.element);
  };

  const drawEmpty = () => {
    drawnEmpty?.dispose();
    drawnEmpty = parts.draw(
      'emptyDoc',
      emptySlot,
      { text: EMPTY_TEXT },
      (kit) => kit,
    );
  };

  const removeEmpty = () => {
    drawnEmpty?.dispose();
    drawnEmpty = null;
  };

  // `data-doc` on the pane's root: a page with no file, no doc, a doc open, or
  // its editor open.
  const showDocState = () => {
    root.dataset.doc =
      page !== null
        ? 'page'
        : shown === null
          ? 'none'
          : editor === null
            ? 'open'
            : 'editing';
  };

  // Whether the history can move each way, on the element `data-doc` is on.
  const showHistoryEdges = () => {
    root.dataset.historyBack = String(history.canBack());
    root.dataset.historyForward = String(history.canForward());
  };

  const recordPlace = (place: DocPlace) => {
    history.push(place);
    showHistoryEdges();
  };

  // Records the place the shown doc is at; a detail or an open editor is no place
  // to return to.
  const recordPlaceInSight = () => {
    if (shown !== null && editor === null && shown.target.detail === null) {
      recordPlace(placeInSight(shown));
    }
  };

  // `i` and `e` refuse on a read-only doc, and inside the editor both are
  // vim's. `e` has nothing of its own to open in a doc with no heading.
  const showEditHint = () => {
    editHint.hidden =
      shown === null || shown.target.readOnly !== null || editor !== null;
    sectionHint.hidden = editHint.hidden || shownSections.length === 0;
  };

  const headerInput = (target: DocTarget): DocHeaderInput => {
    const { entryId } = target;
    const isIndexed = entryId !== null;
    const chips = isIndexed ? deps.chipsOf(entryId, target.path) : null;
    return {
      title: target.title,
      path: deps.paths.tilde(target.path, deps.homeDir),
      fullPath: target.path,
      readOnly: target.readOnly === null ? null : readOnlyText(target.readOnly),
      chips:
        chips === null
          ? []
          : [
              { harness: 'claude', ...chips.claude },
              { harness: 'codex', ...chips.codex },
            ],
      statuses: isIndexed ? deps.statusesOf(entryId) : [],
      loaded: isIndexed ? deps.loadedOf(entryId) : null,
    };
  };

  // Draws the open doc's header, with its chips as they read now; nothing
  // while no doc is open.
  const drawHeader = () => {
    if (isDisposed) {
      return;
    }
    drawnHeader?.dispose();
    drawnHeader = null;
    if (shown === null) {
      return;
    }
    let placing: AppSlot[] = [];
    drawnHeader = parts.draw(
      'docHeader',
      headerSlot,
      headerInput(shown.target),
      (kit, slotFor) => {
        const section = slotFor(sectionHint, 'sectionHint');
        const hint = slotFor(editHint, 'editHint');
        placing = [section, hint];
        return { ...kit, sectionHint: section.place, editHint: hint.place };
      },
    );
    for (const part of placing) {
      part.placeIfLeftOut(drawnHeader.element);
    }
    showEditHint();
  };

  const drawBanner = () => {
    drawnBanner?.dispose();
    drawnBanner = parts.draw(
      'diskBanner',
      bannerSlot,
      { text: BANNER_TEXT },
      (kit) => kit,
    );
  };

  // A section's editor sits at the top of sight, so a notice drawn above it
  // lands out of sight, the browser's scroll anchoring holding the editor still.
  const scrollToSectionNotice = () => {
    const notice = drawnBanner ?? drawnPrompt;
    if (editingSection !== null && notice !== null) {
      pane.scrollTop = topIn(pane, notice.element);
    }
  };

  const showBanner = (isShown: boolean) => {
    if (isShown && drawnBanner === null) {
      drawBanner();
      scrollToSectionNotice();
    } else if (!isShown) {
      drawnBanner?.dispose();
      drawnBanner = null;
    }
  };

  const drawPrompt = () => {
    drawnPrompt?.dispose();
    drawnPrompt = parts.draw(
      'conflictPrompt',
      promptSlot,
      { text: CONFLICT_TEXT },
      (kit) => kit,
    );
  };

  // Draws the body part around the rendered body, hidden while the whole-file
  // editor is open.
  const drawBodyPart = () => {
    drawnBody?.dispose();
    let placing: AppSlot[] = [];
    drawnBody = parts.draw(
      'docBody',
      bodySlot,
      { fields: bodyFields },
      (kit, slotFor) => {
        const placed = slotFor(body, 'body');
        placing = [placed];
        return { ...kit, body: placed.place };
      },
    );
    for (const part of placing) {
      part.placeIfLeftOut(drawnBody.element);
    }
    drawnBody.element.hidden = editor !== null && editingSection === null;
  };

  const drawMainEmpty = (path: string) => {
    drawnMainEmpty?.dispose();
    let placing: AppSlot[] = [];
    drawnMainEmpty = parts.draw(
      'mainEmpty',
      pageSlot,
      { path },
      (kit, slotFor) => {
        const placed = slotFor(mainHint, 'createMainHint');
        placing = [placed];
        return { ...kit, createMainHint: placed.place };
      },
    );
    for (const part of placing) {
      part.placeIfLeftOut(drawnMainEmpty.element);
    }
  };

  const drawPage = (shownPage: DocPage) => {
    if (shownPage.type === 'list') {
      listPane.show(shownPage.content);
    } else {
      drawMainEmpty(shownPage.path);
    }
  };

  const disposePage = () => {
    listPane.clear();
    drawnMainEmpty?.dispose();
    drawnMainEmpty = null;
  };

  // A recent page's link: outside the body, so `followLink` does not hear it.
  const recentPageLink = (
    parent: HTMLElement,
    title: string,
    path: string,
  ): HTMLElement => {
    const link = element('a', 'md-link docs-recent-page', title);
    link.href = '#';
    link.title = deps.paths.tilde(path, deps.homeDir);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      deps.followFile(path, null, null);
    });
    parent.append(link);
    return link;
  };

  const drawRecent = () => {
    drawnRecent?.dispose();
    drawnRecent =
      recentInput === null
        ? null
        : parts.draw('recentChanges', recentSlot, recentInput, (kit) => ({
            ...kit,
            pageLink: recentPageLink,
          }));
  };

  // Draws the right column for the open doc from `shownSections` and the
  // entries.
  const drawAside = () => {
    const doc = shown;
    if (!isMarkdownDoc(doc)) {
      shownSections = [];
      aside.clear();
      return;
    }
    aside.show(shownSections, linkedFrom(entries, doc.target.path));
  };

  const disposeSectionControls = () => {
    const disposing = sectionControls;
    sectionControls = [];
    callEach(disposing, ({ part, slot }) => {
      slot.remove();
      part.dispose();
    });
  };

  // The section whose heading is `heading`, a rendered block of `doc`.
  const sectionOfHeading = (doc: ShownDoc, heading: HTMLElement) => {
    const line = sourceLineOf(heading);
    return line === null
      ? undefined
      : shownSections.find(
          ({ startLine }) => startLine === line + doc.bodyStartLine - 1,
        );
  };

  // Draws an `edit` control into each direct child of the body that heads a
  // section, while the shown doc may be edited by section.
  const drawSectionControls = () => {
    disposeSectionControls();
    const doc = shown;
    if (!isMarkdownDoc(doc) || doc.target.readOnly !== null) {
      return;
    }
    for (const heading of [...body.children] as HTMLElement[]) {
      const { anchor } = heading.dataset;
      const section = sectionOfHeading(doc, heading);
      if (anchor === undefined || section === undefined) {
        continue;
      }
      const slot = element('span', 'docs-slot');
      heading.append(slot);
      const part = parts.draw(
        'sectionEditControl',
        slot,
        { title: section.title },
        (kit) => ({ ...kit, openSection: () => clickSection(anchor) }),
      );
      sectionControls.push({ part, slot });
    }
  };

  // The entry for the whole file at `path`, not for an item inside it.
  const fileEntryAt = (path: string) =>
    entries.find(
      (entry) => entry.line === null && deps.paths.samePath(entry.path, path),
    );

  // The section links `doc`'s file's own entry holds; a follow-up file's holds
  // none, so a `§` in it stays plain.
  const sectionLinksOf = (doc: ShownDoc | null): IndexLink[] => {
    if (!isMarkdownDoc(doc)) {
      return [];
    }
    return (fileEntryAt(doc.target.path)?.links ?? []).filter(
      (link) => link.form === 'section',
    );
  };

  // Takes the title the index now gives the shown target, which its entry names,
  // else its file's entry; with neither it keeps its own.
  const refreshTitle = () => {
    const doc = shown;
    if (doc === null) {
      return;
    }
    const { entryId, path, title } = doc.target;
    const entry =
      entryId === null
        ? fileEntryAt(path)
        : entries.find(({ id }) => id === entryId);
    if (entry !== undefined && entry.title !== title) {
      doc.target = { ...doc.target, title: entry.title };
      drawHeader();
    }
  };

  const linkTitle = ({ target, targetLine }: IndexLink): string => {
    const path = deps.paths.tilde(target, deps.homeDir);
    return targetLine === null ? path : `${path}:${String(targetLine)}`;
  };

  const applySectionLinks = () => {
    const links = sectionLinksOf(shown);
    appliedLinks = JSON.stringify(links);
    if (shown !== null) {
      linkSections(body, links, shown.bodyStartLine, linkTitle);
    }
  };

  const drawBody = (rendered: Rendered) => {
    heldSection = null;
    bodyFields = rendered.fields;
    bodyMount.draw(body, rendered.html, { liveFences: rendered.liveFences });
    applySectionLinks();
    if (isMarkdownDoc(shown)) {
      shownSections = sectionsOf(shown.text);
    }
    drawAside();
    drawSectionControls();
    drawBodyPart();
    showEditHint();
  };

  const drawEditorFrame = (doc: ShownDoc) => {
    drawnEditorFrame?.dispose();
    let placing: AppSlot[] = [];
    drawnEditorFrame = parts.draw(
      'editorFrame',
      editorSlot,
      { name: doc.name, path: doc.filePath },
      (kit, slotFor) => {
        const placed = slotFor(editorBox, 'editor');
        placing = [placed];
        return { ...kit, editor: placed.place };
      },
    );
    for (const part of placing) {
      part.placeIfLeftOut(drawnEditorFrame.element);
    }
  };

  // The rendered blocks with a box: a section's editor hides its own.
  const shownSourceBlocks = () =>
    sourceBlocks(body, pane, editingSection?.hidden);

  // Of the blocks at any depth, the one whose whole-file line is the greatest at
  // or before `line`, or the section's editor while it hides that line.
  const scrollToLine = (line: number, bodyStartLine: number) => {
    const edited = editingSection?.section;
    const isHiddenForEdit =
      edited !== undefined &&
      line >= edited.startLine &&
      line <= edited.endLine;
    if (isHiddenForEdit && drawnEditorFrame !== null) {
      pane.scrollTop = topIn(pane, drawnEditorFrame.element);
      return;
    }
    const blocks = shownSourceBlocks().filter(
      (block) => block.line + bodyStartLine - 1 <= line,
    );
    const target = blocks.reduce<{ line: number; top: number } | null>(
      (best, block) =>
        best === null || block.line >= best.line ? block : best,
      null,
    );
    pane.scrollTop = target?.top ?? 0;
  };

  const scrollToLineOrTop = (line: number | null, bodyStartLine: number) => {
    if (line === null) {
      pane.scrollTop = 0;
    } else {
      scrollToLine(line, bodyStartLine);
    }
  };

  const headingAt = (fragment: string) =>
    body.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(fragment)}"]`);

  // Scrolls to the heading's top, or to the section's editor while it hides
  // the heading; false when this doc has none.
  const scrollToHeading = (fragment: string): boolean => {
    const heading = headingAt(fragment);
    if (heading === null) {
      return false;
    }
    const isHiddenForEdit = editingSection?.hidden.some((child) =>
      child.contains(heading),
    );
    pane.scrollTop = topIn(
      pane,
      isHiddenForEdit ? (drawnEditorFrame?.element ?? heading) : heading,
    );
    return true;
  };

  const toastMissingHeading = (fragment: string) =>
    deps.toast(`No heading #${fragment} in this doc`, 'info');

  // The place `doc` shows at the top of sight; a null line at the very top.
  const placeInSight = (doc: ShownDoc): DocPlace => ({
    path: doc.target.path,
    line:
      pane.scrollTop === 0
        ? null
        : topVisibleLine(
            shownSourceBlocks(),
            pane.scrollTop,
            doc.bodyStartLine,
          ),
  });

  // Scrolls the shown doc to `line`, else its top, then to the heading
  // `fragment`, recording the place in sight before and after, so a move that did
  // not scroll records one. It reads and closes nothing, so a section's editor
  // stays. A missing heading toasts and records nothing, since the scroll has not
  // moved.
  const moveWithinDoc = (line: number | null, fragment: string | null) => {
    const doc = shown;
    if (doc === null) {
      return;
    }
    if (fragment !== null && headingAt(fragment) === null) {
      toastMissingHeading(fragment);
      return;
    }
    recordPlace(placeInSight(doc));
    scrollToLineOrTop(line, doc.bodyStartLine);
    if (fragment !== null) {
      scrollToHeading(fragment);
    }
    recordPlace(placeInSight(doc));
    if (line !== null) {
      deps.log(`moved within ${doc.name} to line ${line}`);
    }
  };

  // Where `anchor` leads: a section link holds its target, any other its href.
  const linkTargetOf = (anchor: HTMLElement, fromFile: string): LinkTarget => {
    const { docPath, docLine, href } = anchor.dataset;
    return docPath === undefined
      ? resolveLink(href ?? '', fromFile, deps.homeDir, deps.paths)
      : {
          type: 'file',
          path: docPath,
          line: docLine === undefined ? null : Number(docLine),
          fragment: null,
        };
  };

  function followLink(event: MouseEvent) {
    const anchor = (event.target as Element).closest<HTMLElement>('a.md-link');
    if (anchor === null || shown === null) {
      return;
    }
    event.preventDefault();
    const fromFile = shown.target.path;
    const target = linkTargetOf(anchor, fromFile);
    switch (target.type) {
      case 'external':
        deps.channel
          .invoke('openExternal', target.url)
          .then(() => deps.log(`opened link ${target.url}`))
          .catch((error) => deps.toast(errorText(error), 'error'));
        break;
      case 'heading':
        moveWithinDoc(null, target.fragment);
        break;
      case 'file':
        if (deps.paths.samePath(target.path, fromFile)) {
          moveWithinDoc(target.line, target.fragment);
        } else {
          deps.followFile(target.path, target.line, target.fragment);
        }
        break;
      case 'unsupported':
        if (!deps.followWikiLink(target.href, anchor.textContent ?? '')) {
          deps.toast(`This link does not open here: ${target.href}`, 'info');
        }
        break;
    }
  }

  const endConflict = (refocus: boolean) => {
    if (conflict === null) {
      return;
    }
    conflict.scope.pop();
    conflict = null;
    drawnPrompt?.dispose();
    drawnPrompt = null;
    if (refocus) {
      editor?.focus();
    }
  };

  const showConflict = (diskText: string, after: AfterWrite) => {
    endConflict(false);
    editor?.blur();
    const scope = deps.pushConflictScope();
    scope.onBaseChanged(() => {
      if (conflict?.scope === scope) {
        endConflict(false);
      }
    });
    conflict = { diskText, after, scope };
    drawPrompt();
    scrollToSectionNotice();
  };

  const watchFile = (path: string | null, name: string) => {
    deps.channel
      .invoke('watchDoc', deps.viewId, path)
      .catch((error) => deps.log(`not watching ${name}: ${errorText(error)}`));
  };

  // Shows the detail's field table, the file it edits let go.
  const showDetail = (doc: ShownDoc, detail: DocDetail) => {
    doc.filePath = doc.target.path;
    doc.name = deps.paths.base(doc.target.path);
    doc.text = '';
    drawBody(detailRendered(detail));
    watchFile(null, doc.name);
  };

  // Puts back what a section's editor moved or hid.
  const restoreSectionLayout = ({ hidden }: EditingSection) => {
    for (const block of hidden) {
      block.hidden = false;
    }
    article.insertBefore(bannerSlot, bodySlot);
    article.insertBefore(promptSlot, bodySlot);
    article.append(editorSlot);
    editorBox.classList.remove('is-section');
    // An empty value removes the property.
    editorBox.style.setProperty('--docs-section-rows', '');
  };

  // Destroys the editor and removes its frame; the pane's frame, the page frame
  // and the body part a reload left for later draw now.
  const dropEditor = () => {
    endConflict(false);
    editor?.destroy();
    editor = null;
    dropTarget?.dispose();
    dropTarget = null;
    editorBox.replaceChildren();
    drawnEditorFrame?.dispose();
    drawnEditorFrame = null;
    pane.classList.remove('is-editing');
    if (editingSection !== null) {
      restoreSectionLayout(editingSection);
      editingSection = null;
    }
    if (drawnBody !== null) {
      drawnBody.element.hidden = false;
    }
    showBanner(false);
    showEditHint();
    showDocState();
    if (isPaneRedrawDeferred) {
      isPaneRedrawDeferred = false;
      drawPane();
      drawFrame();
    }
    if (isBodyRedrawDeferred) {
      isBodyRedrawDeferred = false;
      drawBodyPart();
    }
  };

  // Draws `rendered` as `doc`'s body, then puts the pane back at `scrollTop`.
  const drawKeepingScroll = (
    doc: ShownDoc,
    rendered: Rendered,
    scrollTop: number,
  ) => {
    doc.bodyStartLine = rendered.bodyStartLine;
    drawBody(rendered);
    pane.scrollTop = scrollTop;
  };

  // Destroys the editor and shows the rendered doc from the text last read
  // or written, or the detail view it was opened from, at the scroll the
  // pane had as the editor opened, set again once the body draws. `after` runs
  // once it has; a failed render logs and skips it. `shownSections` empties until
  // then, since `doc.text` may be newer than the body: a section read from them
  // would splice the wrong lines.
  const closeEditor = (doc: ShownDoc, after?: () => void) => {
    shownSections = [];
    dropEditor();
    deps.log(`closed the editor on ${doc.name}`);
    pane.focus();
    const scrollTop = scrollTopBeforeEdit;
    pane.scrollTop = scrollTop;
    if (doc.target.detail !== null) {
      showDetail(doc, doc.target.detail);
      pane.scrollTop = scrollTop;
      after?.();
      return;
    }
    renderText(deps.markdown, doc.filePath, doc.text, deps.paths)
      .then((rendered) => {
        if (!isDisposed && shown === doc && editor === null) {
          drawKeepingScroll(doc, rendered, scrollTop);
          after?.();
        }
      })
      .catch((error) => deps.log(`not rendered: ${errorText(error)}`));
  };

  const writeEditor = (overwrite: boolean, after: AfterWrite) => {
    const doc = shown;
    const writing = editor;
    if (doc === null || writing === null) {
      return;
    }
    const edited = writing.text();
    const editing = editingSection;
    const text =
      editing === null
        ? edited
        : spliceSection(editing.openedText, editing.section, edited);
    writingText = text;
    deps.channel
      .invoke('writeDoc', doc.filePath, text, overwrite ? null : doc.text)
      .then((result) => {
        if (shown !== doc || editor !== writing) {
          return;
        }
        if (result.type === 'changedOnDisk') {
          showConflict(result.diskText, after);
          deps.log(`changed on disk, not written: ${doc.name}`);
          return;
        }
        doc.text = text;
        if (editing !== null) {
          editing.savedText = edited;
        }
        showBanner(false);
        deps.toast(`Wrote ${doc.name}`, 'success');
        deps.log(`wrote ${doc.name}`);
        if (after === 'close') {
          closeEditor(doc);
        }
      })
      .catch((error) => {
        deps.toast(errorText(error), 'error');
        deps.log(`not written ${doc.name}: ${errorText(error)}`);
      })
      .finally(() => {
        writingText = null;
      });
  };

  const hasUnsaved = () =>
    editor !== null &&
    shown !== null &&
    editor.text() !== (editingSection?.savedText ?? shown.text);

  const quitEditor = (force: boolean) => {
    if (shown === null || editor === null) {
      return;
    }
    const isUnsaved = hasUnsaved();
    if (isUnsaved && !force) {
      deps.toast(UNSAVED_TEXT, 'error');
      deps.log(
        `refused to close the editor with unsaved edits on ${shown.name}`,
      );
      return;
    }
    if (isUnsaved) {
      deps.log(`dropped edits on ${shown.name}`);
    }
    closeEditor(shown);
  };

  const showSectionRows = (text: string) =>
    editorBox.style.setProperty('--docs-section-rows', String(lineCount(text)));

  const editorEvents: DocumentEditorEvents = {
    changed: (text) => {
      if (editingSection !== null) {
        showSectionRows(text);
      }
    },
    write: () => writeEditor(false, 'stay'),
    quit: quitEditor,
    writeQuit: () => writeEditor(false, 'close'),
    modeChanged: () => undefined,
  };

  const reread = async (doc: ShownDoc) => {
    const diskText = await deps.channel.invoke('readDoc', doc.filePath);
    if (isDisposed || shown !== doc || diskText === writingText) {
      return;
    }
    if (editor !== null) {
      if (diskText !== doc.text) {
        showBanner(true);
        deps.log(`changed on disk: ${doc.name}`);
      }
      return;
    }
    if (doc.target.detail !== null) {
      return;
    }
    const rendered = await renderText(
      deps.markdown,
      doc.filePath,
      diskText,
      deps.paths,
    );
    if (isDisposed || shown !== doc || editor !== null) {
      return;
    }
    doc.text = diskText;
    drawKeepingScroll(doc, rendered, pane.scrollTop);
    deps.log(`reloaded ${doc.name}`);
  };

  // Renders the shown text again, keeping the scroll, for links the index
  // brought after the body drew. A text newer than this render draws its own.
  const relink = async (doc: ShownDoc) => {
    const { text } = doc;
    const rendered = await renderText(
      deps.markdown,
      doc.filePath,
      text,
      deps.paths,
    );
    if (isDisposed || shown !== doc || editor !== null || doc.text !== text) {
      return;
    }
    drawKeepingScroll(doc, rendered, pane.scrollTop);
  };

  const relinkLogging = (doc: ShownDoc) => {
    relink(doc).catch((error) => deps.log(`not rendered: ${errorText(error)}`));
  };

  // The index each pasted file of a take at `now` is named with, in order;
  // a take in a new second starts again at 0.
  const claimPasteIndexes = (
    files: readonly DroppedFile[],
    now: number,
  ): number[] => {
    const stamp = fileStamp(now);
    if (stamp !== pasteStamp) {
      pasteStamp = stamp;
      nextPasteIndex = 0;
    }
    return files.filter((file) => file.path === '').map(() => nextPasteIndex++);
  };

  // Writes a pasted file beside the doc and resolves to its path; null when
  // main refused, which toasts.
  const writePasted = async (
    doc: ShownDoc,
    file: DroppedFile,
    now: number,
    index: number,
  ): Promise<string | null> => {
    const path = pastedImagePath(
      doc.filePath,
      file.mediaType,
      now,
      index,
      deps.paths,
    );
    try {
      await deps.channel.invoke('writeBytes', path, await file.bytes());
      deps.log(`saved pasted ${file.name} as ${path}`);
      return path;
    } catch (error) {
      deps.toast(errorText(error), 'error');
      deps.log(`not saved pasted ${file.name}: ${errorText(error)}`);
      return null;
    }
  };

  // Links every file at the editor's cursor, once each pasted one is saved,
  // while the doc and editor the take began on are still open; else toasts
  // the paths of the pasted files it saved.
  const takeFiles = async (files: readonly DroppedFile[]) => {
    const doc = shown;
    const taking = editor;
    if (doc === null || taking === null) {
      return;
    }
    const now = deps.now();
    const pasteIndexes = claimPasteIndexes(files, now);
    const links: string[] = [];
    const savedPaths: string[] = [];
    for (const file of files) {
      const isPasted = file.path === '';
      const path = isPasted
        ? await writePasted(doc, file, now, pasteIndexes.shift()!)
        : file.path;
      if (path === null) {
        continue;
      }
      if (isPasted) {
        savedPaths.push(path);
      }
      links.push(docLinkOf(path, doc.filePath, file.mediaType, deps.paths));
    }
    if (shown !== doc || editor !== taking) {
      deps.log(`not linked: the editor on ${doc.name} closed`);
      if (savedPaths.length > 0) {
        deps.toast(
          `Saved ${savedPaths.join(', ')}, not linked: the editor closed`,
          'info',
        );
      }
      return;
    }
    if (links.length === 0) {
      return;
    }
    taking.insert(docLinksText(links, taking.charBeforeCursor()));
    deps.log(`linked ${String(links.length)} in ${doc.name}`);
  };

  // What every editor does once it exists: takes drops, and takes focus.
  const startEditing = (focusing: DocumentEditor) => {
    dropTarget = deps.drops.addTarget({
      element: pane,
      take: (files) => {
        takeFiles(files).catch((error) =>
          deps.log(`not linked: ${errorText(error)}`),
        );
      },
    });
    showEditHint();
    showDocState();
    focusing.focus();
  };

  // The frame draws first, so the editor mounts into an attached host.
  const openEditor = (doc: ShownDoc, line: number) => {
    pane.classList.add('is-editing');
    scrollTopBeforeEdit = pane.scrollTop;
    pane.scrollTop = 0;
    drawEditorFrame(doc);
    editor = deps.editor.createDocument(
      editorBox,
      doc.text,
      { fileName: doc.name, readOnly: false, line },
      editorEvents,
    );
    if (drawnBody !== null) {
      drawnBody.element.hidden = true;
    }
    startEditing(editor);
    deps.log(`editing ${doc.name}`);
  };

  // Opens `section` in place: its rendered blocks hide, and the editor's frame,
  // with the banner and prompt slots above it, takes their place in the body.
  const openSectionEditor = (
    doc: ShownDoc,
    section: DocSection,
    line: number,
  ) => {
    const blocks = [...body.children] as HTMLElement[];
    const flags = hiddenBlockFlags(
      blocks.map(sourceLineOf),
      section,
      doc.bodyStartLine,
    );
    const hidden = blocks.filter((_block, index) => flags[index]);
    const text = sectionText(doc.text, section);
    scrollTopBeforeEdit = pane.scrollTop;
    for (const block of hidden) {
      block.hidden = true;
    }
    const firstHidden = hidden.at(0) ?? null;
    body.insertBefore(bannerSlot, firstHidden);
    body.insertBefore(promptSlot, firstHidden);
    body.insertBefore(editorSlot, firstHidden);
    editingSection = {
      openedText: doc.text,
      section,
      savedText: text,
      hidden,
    };
    editorBox.classList.add('is-section');
    showSectionRows(text);
    drawEditorFrame(doc);
    editor = deps.editor.createDocument(
      editorBox,
      text,
      { fileName: doc.name, readOnly: false, line },
      editorEvents,
    );
    if (drawnEditorFrame !== null) {
      pane.scrollTop = topIn(pane, drawnEditorFrame.element);
    }
    startEditing(editor);
    deps.log(`editing section ${section.title} in ${doc.name}`);
  };

  // Opens the section the heading at `anchor` starts, in the body drawn now.
  const openSectionAt = (doc: ShownDoc, anchor: string) => {
    const heading = ([...body.children] as HTMLElement[]).find(
      (child) => child.dataset.anchor === anchor,
    );
    const section =
      heading === undefined ? undefined : sectionOfHeading(doc, heading);
    if (section === undefined) {
      deps.log(`no heading #${anchor} to edit`);
      return;
    }
    openSectionEditor(doc, section, 1);
  };

  // A section's `edit` control. An open editor with edits stays; a clean one
  // closes first, so the section is read from a body drawn from the file's text.
  function clickSection(anchor: string) {
    const doc = shown;
    if (doc === null || view.refuseWithUnsavedEdits()) {
      return;
    }
    if (editor === null) {
      openSectionAt(doc, anchor);
      return;
    }
    closeEditor(doc, () => openSectionAt(doc, anchor));
  }

  // Replaces the file's text with the disk's, then closes and opens again, so
  // the page and the editor both show it. The section is found again by its
  // heading; gone, only the page stays.
  const reloadSection = (
    doc: ShownDoc,
    section: DocSection,
    diskText: string,
  ) => {
    endConflict(false);
    const moved = relocateSection(doc.text, section.startLine, diskText);
    doc.text = diskText;
    showBanner(false);
    deps.log(`reloaded ${doc.name}`);
    if (moved !== null) {
      closeEditor(doc, () => openSectionEditor(doc, moved, 1));
      return;
    }
    closeEditor(doc);
    deps.toast(
      `The section "${section.title}" is no longer in the file`,
      'info',
    );
  };

  // Toasts and logs the refusal when the doc is read-only.
  const refuseReadOnly = (doc: ShownDoc): boolean => {
    const { readOnly } = doc.target;
    if (readOnly === null) {
      return false;
    }
    deps.toast(readOnlyText(readOnly), 'info');
    deps.log(
      readOnly.type === 'downloaded'
        ? `refused to edit ${doc.name}, a downloaded copy`
        : `refused to edit ${doc.name} in the plugin cache`,
    );
    return true;
  };

  // The heading the last move landed on, while the pane stays where it left it.
  const heldLine = () =>
    heldSection !== null && pane.scrollTop === heldSection.scrollTop
      ? heldSection.line
      : null;

  // Opens the file the detail finds in the editor, watched while it edits.
  const editDetail = async (doc: ShownDoc, detail: DocDetail) => {
    const file = await detail.editFile();
    if (isDisposed || file === null || shown !== doc || editor !== null) {
      return;
    }
    doc.filePath = file.path;
    doc.name = deps.paths.base(file.path);
    doc.text = file.text;
    watchFile(file.path, doc.name);
    openEditor(doc, file.line);
  };

  // Every drawn part of the pane draws again; while the editor is open the
  // pane's frame and the page frame wait for it to close, and the editor's
  // frame stays. The body part waits too while it holds a section's editor.
  const redrawParts = () => {
    if (editor === null) {
      drawPane();
      drawFrame();
    } else {
      isPaneRedrawDeferred = true;
    }
    if (drawnEmpty !== null) {
      drawEmpty();
    }
    if (drawnHeader !== null) {
      drawHeader();
    }
    if (drawnBanner !== null) {
      drawBanner();
    }
    if (drawnPrompt !== null) {
      drawPrompt();
    }
    if (drawnBody !== null && editingSection === null) {
      drawBodyPart();
    } else if (drawnBody !== null) {
      isBodyRedrawDeferred = true;
    }
    if (aside.isShown()) {
      drawAside();
    }
    drawSectionControls();
    if (page !== null) {
      drawPage(page);
    }
    if (recentInput !== null) {
      drawRecent();
    }
  };

  // Moves one place through the history, and leaves the position unmoved while
  // unsaved edits refuse. Another file's place opens through `followPlace`, whose
  // `view.open` closes a clean editor as any open does; a gone doc toasts there
  // with the position on it, so the next press moves past it.
  const moveInHistory = (step: 1 | -1) => {
    if (view.refuseWithUnsavedEdits()) {
      return;
    }
    const place = step === -1 ? history.back() : history.forward();
    showHistoryEdges();
    if (place === null) {
      deps.log(step === -1 ? 'no earlier place' : 'no later place');
      return;
    }
    const doc = shown;
    if (doc === null || !deps.paths.samePath(doc.target.path, place.path)) {
      deps.followPlace(place.path, place.line);
      return;
    }
    if (editor === null) {
      scrollToLineOrTop(place.line, doc.bodyStartLine);
      return;
    }
    closeEditor(doc, () => scrollToLineOrTop(place.line, doc.bodyStartLine));
  };

  const view: DocView = {
    element: root,
    async open(target, options) {
      if (view.refuseWithUnsavedEdits()) {
        return false;
      }
      const count = ++openCount;
      let text = '';
      let rendered: Rendered = {
        fields: [],
        html: '',
        bodyStartLine: 1,
        liveFences: true,
      };
      try {
        if (target.detail === null) {
          text = await deps.channel.invoke('readDoc', target.path);
          rendered = await renderText(
            deps.markdown,
            target.path,
            text,
            deps.paths,
          );
        } else {
          rendered = detailRendered(target.detail);
        }
      } catch (error) {
        const failure = `Could not open ${deps.paths.tilde(target.path, deps.homeDir)}: ${errorText(error)}`;
        deps.toast(failure, 'error');
        deps.log(failure);
        return false;
      }
      if (count !== openCount || isDisposed || view.hasUnsavedEdits()) {
        return false;
      }
      const isRecorded = options?.isHistoryMove !== true;
      if (isRecorded) {
        recordPlaceInSight();
      }
      if (shown !== null && editor !== null) {
        closeEditor(shown);
      }
      const name = deps.paths.base(target.path);
      shown = {
        target,
        filePath: target.path,
        name,
        text,
        bodyStartLine: rendered.bodyStartLine,
      };
      page = null;
      disposePage();
      deps.openChanged(target.path);
      removeEmpty();
      showDocState();
      showBanner(false);
      drawHeader();
      drawBody(rendered);
      pane.scrollTop = 0;
      aside.scrollToTop();
      watchFile(target.detail === null ? target.path : null, name);
      deps.log(`opened ${name}`);
      if (target.line !== null) {
        scrollToLine(target.line, rendered.bodyStartLine);
      }
      if (target.fragment !== null && !scrollToHeading(target.fragment)) {
        toastMissingHeading(target.fragment);
      }
      if (isRecorded) {
        recordPlaceInSight();
      }
      showHistoryEdges();
      return true;
    },
    openPath: () => shown?.target.path ?? null,
    showPage(next, options) {
      if (isDisposed || view.refuseWithUnsavedEdits()) {
        return false;
      }
      openCount++;
      const isRecorded = options?.isHistoryMove !== true;
      if (isRecorded) {
        recordPlaceInSight();
      }
      if (shown !== null && editor !== null) {
        closeEditor(shown);
      }
      if (shown !== null) {
        watchFile(null, shown.name);
        shown = null;
        deps.openChanged(null);
      }
      disposePage();
      removeEmpty();
      showBanner(false);
      drawHeader();
      drawBody({ fields: [], html: '', bodyStartLine: 1, liveFences: true });
      page = next;
      showDocState();
      pane.scrollTop = 0;
      drawPage(next);
      if (next.type === 'list' && isRecorded) {
        recordPlace({ path: next.content.place, line: null });
      }
      return true;
    },
    updateList(content) {
      if (isDisposed || page?.type !== 'list') {
        return;
      }
      page = { type: 'list', content };
      const { scrollTop } = pane;
      listPane.show(content);
      pane.scrollTop = scrollTop;
    },
    shownPage: () => page,
    isBlank: () => openCount === 0 && shown === null && page === null,
    setRecentChanges(input) {
      if (isDisposed) {
        return;
      }
      recentInput = input;
      drawRecent();
    },
    listOpen() {
      if (listPane.isShown()) {
        listPane.openCursor();
        return;
      }
      const active = pane.ownerDocument.activeElement;
      if (active !== null && pane.contains(active)) {
        active.closest<HTMLElement>('a, button')?.click();
      }
    },
    retarget(target) {
      const doc = shown;
      if (doc === null || isDisposed) {
        return;
      }
      const wasDetail = doc.target.detail !== null;
      doc.target = target;
      deps.openChanged(target.path);
      if (target.detail === null) {
        doc.filePath = target.path;
        doc.name = deps.paths.base(target.path);
        watchFile(target.path, doc.name);
      }
      showBanner(false);
      drawAside();
      drawSectionControls();
      drawHeader();
      if (editor !== null || target.detail !== null) {
        return;
      }
      // A detail holds no text of the file to render.
      if (wasDetail) {
        reread(doc).catch((error) =>
          deps.log(`not reloaded ${doc.name}: ${errorText(error)}`),
        );
      } else {
        relinkLogging(doc);
      }
    },
    clear() {
      if (shown === null || isDisposed) {
        return;
      }
      openCount++;
      dropEditor();
      watchFile(null, shown.name);
      shown = null;
      deps.openChanged(null);
      showDocState();
      drawEmpty();
      drawHeader();
      drawBody({ fields: [], html: '', bodyStartLine: 1, liveFences: true });
    },
    refreshChips: () => drawHeader(),
    setEntries(next) {
      if (isDisposed) {
        return;
      }
      entries = next;
      drawAside();
      const doc = shown;
      const hasNewLinks = JSON.stringify(sectionLinksOf(doc)) !== appliedLinks;
      if (doc !== null && editor === null && hasNewLinks) {
        relinkLogging(doc);
      }
      refreshTitle();
    },
    diskChanged(changedPath) {
      const doc = shown;
      const isWatching =
        doc !== null && (doc.target.detail === null || editor !== null);
      if (!isWatching || doc.filePath !== changedPath) {
        return;
      }
      reread(doc).catch((error) =>
        deps.log(`not reloaded ${doc.name}: ${errorText(error)}`),
      );
    },
    edit(line) {
      if (page?.type === 'mainEmpty') {
        deps.createMain();
        return;
      }
      const doc = shown;
      if (doc === null) {
        return;
      }
      if (refuseReadOnly(doc)) {
        return;
      }
      if (editor !== null) {
        editor.focus();
        return;
      }
      if (doc.target.detail !== null) {
        editDetail(doc, doc.target.detail).catch((error) =>
          deps.toast(errorText(error), 'error'),
        );
        return;
      }
      openEditor(
        doc,
        line ??
          topVisibleLine(
            shownSourceBlocks(),
            pane.scrollTop,
            doc.bodyStartLine,
          ),
      );
    },
    editSection() {
      const doc = shown;
      if (doc === null || refuseReadOnly(doc)) {
        return;
      }
      if (editor !== null) {
        editor.focus();
        return;
      }
      if (!isMarkdownDoc(doc)) {
        deps.toast(NOT_SECTIONED_TEXT, 'info');
        return;
      }
      const line =
        heldLine() ??
        topVisibleLine(shownSourceBlocks(), pane.scrollTop, doc.bodyStartLine);
      const section = sectionAt(shownSections, line);
      if (section === null) {
        view.edit();
        return;
      }
      openSectionEditor(doc, section, line - section.startLine + 1);
    },
    moveSection(direction) {
      const doc = shown;
      if (doc === null || shownSections.length === 0) {
        deps.log('no section to move to');
        return;
      }
      if (editor !== null) {
        deps.log('not moved: the editor is open');
        return;
      }
      const blocks = shownSourceBlocks();
      const headings = shownSections.flatMap(({ title, startLine }) => {
        const block = blocks.find(
          ({ line }) => line + doc.bodyStartLine - 1 === startLine,
        );
        return block === undefined
          ? []
          : [{ title, startLine, top: block.top }];
      });
      const line = sectionMoveTarget(
        headings,
        pane.scrollTop,
        direction,
        heldLine(),
      );
      const heading = headings.find(({ startLine }) => startLine === line);
      if (heading === undefined) {
        deps.log(direction === 1 ? 'no next section' : 'no previous section');
        return;
      }
      pane.scrollTop = heading.top;
      heldSection = { line: heading.startLine, scrollTop: pane.scrollTop };
      deps.log(`section ${heading.title}`);
    },
    quitEditor: () => quitEditor(false),
    historyBack: () => moveInHistory(-1),
    historyForward: () => moveInHistory(1),
    scroll(by) {
      if (listPane.isShown()) {
        listPane.move(by);
        return;
      }
      pane.scrollTop += by * textLineHeightPx(pane);
    },
    scrollBy(step, direction) {
      const name = shown?.name ?? 'the doc pane';
      if (editor === null) {
        const scroll = scrollContent(
          pane,
          step,
          direction,
          textLineHeightPx(pane),
        );
        deps.log(scrollText(name, step, direction, scroll));
        return;
      }
      editor
        .scrollBy(step, direction)
        .then((scroll) =>
          deps.log(editorScrollText(name, step, direction, scroll)),
        )
        .catch((error) =>
          deps.log(`not scrolled ${name}: ${errorText(error)}`),
        );
    },
    focus() {
      if (editor !== null) {
        editor.focus();
      } else {
        pane.focus();
      }
    },
    hasUnsavedEdits: hasUnsaved,
    refuseWithUnsavedEdits() {
      if (!view.hasUnsavedEdits()) {
        return false;
      }
      deps.toast(UNSAVED_TEXT, 'error');
      deps.log(`refused to leave ${shown?.name} with unsaved edits`);
      return true;
    },
    conflictReload() {
      const held = conflict;
      if (held === null || editor === null || shown === null) {
        return;
      }
      if (editingSection !== null) {
        reloadSection(shown, editingSection.section, held.diskText);
        return;
      }
      endConflict(true);
      editor.setText(held.diskText);
      shown.text = held.diskText;
      showBanner(false);
      deps.log(`reloaded ${shown.name}`);
    },
    conflictOverwrite() {
      const held = conflict;
      if (held === null) {
        return;
      }
      endConflict(true);
      writeEditor(true, held.after);
    },
    conflictCancel() {
      if (conflict === null || shown === null) {
        return;
      }
      endConflict(true);
      deps.log(`kept editing ${shown.name}`);
    },
    closeConflict() {
      endConflict(false);
    },
    redraw() {
      if (isDisposed) {
        return;
      }
      // While the editor is open, `redrawParts` leaves the pane's frame, the
      // page frame and the editor's undrawn, and the body part under a section's
      // editor, so their picks leave the compared set: all but the editor's draw
      // once the editor closes, the editor's at the next edit.
      parts.redrawIfChanged(() =>
        keepingFocusAndScroll(root, [pane, aside.element], redrawParts),
      );
    },
    dispose() {
      isDisposed = true;
      const destroying = editor;
      editor = null;
      const drawn = [
        drawnPane,
        drawnFrame,
        drawnEmpty,
        drawnHeader,
        drawnBanner,
        drawnBody,
        drawnEditorFrame,
        drawnMainEmpty,
        drawnRecent,
      ];
      callEach<() => void>(
        [
          () => endConflict(false),
          () => destroying?.destroy(),
          () => dropTarget?.dispose(),
          () => watchFile(null, shown?.name ?? 'the doc'),
          () => disposeAnchors(anchors),
          () => bodyMount.dispose(),
          () => disposeSectionControls(),
          () => listPane.dispose(),
          () => aside.dispose(),
          ...drawn.map((part) => () => part?.dispose()),
        ],
        (step) => step(),
      );
    },
  };

  showDocState();
  showHistoryEdges();
  drawPane();
  drawFrame();
  drawEmpty();
  drawBody({ fields: [], html: '', bodyStartLine: 1, liveFences: true });
  return view;
}
