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
import type { DocsChannel, IndexEntry } from '../contract';
import { splitFrontmatter } from '../frontmatter';
import type {
  AsideHeadingInput,
  AsideLinkInput,
  DocHeaderInput,
} from '../layouts/layout';
import { linkedFrom } from '../linked-from';
import { resolveLink } from '../links';
import {
  type DocSection,
  sectionAt,
  sectionsOf,
  sectionText,
  spliceSection,
} from '../sections';
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
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import { type DocsParts, type DrawnPart } from './layout/docs-parts';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';

const BANNER_TEXT = 'Changed on disk since you opened it';
const CONFLICT_TEXT = 'File changed on disk';
const EMPTY_TEXT = 'Open a doc from the tree';
const ON_THIS_PAGE_TEXT = 'On this page';
const LINKED_FROM_TEXT = 'Linked from';
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
  // Pushes `docs.conflict` while the changed-on-disk prompt shows.
  pushConflictScope(): PushedScope;
  anchor: DocsAnchor;
  // Draws the pane's parts through the docs layout.
  parts: DocsParts;
  // Hears the open doc's path each time a doc opens or the open one moves,
  // and null once the pane is emptied.
  openChanged(path: string | null): void;
}

// The doc pane, drawn by the layout's `docPane` around the app's scroller:
// in `default`, a top row holding the `‹ tree ⌥H` edge prompt while a doc is
// open and the tree shows, above the scroller. The scroller holds the empty
// state ending in the `Esc tree` hint while no doc is open, and the layout's
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
// `open` resolves to whether the doc opened.
export interface DocView {
  element: HTMLElement;
  open(target: DocTarget): Promise<boolean>;
  openPath(): string | null;
  // The open doc's file moved: the pane, its editor included, follows it to
  // `target`, watching the new path. An open editor's frame keeps the name
  // and path it opened with, since the editor never moves while open.
  retarget(target: DocTarget): void;
  // Empties the pane, its editor dropped and its watch stopped.
  clear(): void;
  refreshChips(): void;
  // Holds the index's entries and draws the right column again.
  setEntries(entries: readonly IndexEntry[]): void;
  diskChanged(path: string): void;
  // Opens the editor at `line`, else at the top visible line.
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
  // Scrolls the pane a line, logging nothing.
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

// One row of the right column: its part's input, its root's tooltip and what
// a click on it does.
interface AsideRow {
  input: AsideLinkInput;
  tooltip: string;
  action(): void;
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

// Whether `doc` is a markdown file, the one kind of doc with a right column.
function hasAside(doc: ShownDoc | null): doc is ShownDoc {
  return (
    doc !== null && doc.target.detail === null && doc.filePath.endsWith('.md')
  );
}

// Places a part's two app elements its layout left out, as its contract
// states: the first at the start of `root`, the last at its end.
function placeAtEnds([first, last]: AppSlot[], root: HTMLElement): void {
  first.placeIfLeftOut(root, 'start');
  last.placeIfLeftOut(root, 'end');
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
  const emptySlot = partSlot();
  const frameSlot = partSlot();
  const headerSlot = partSlot();
  const bannerSlot = partSlot();
  const promptSlot = partSlot();
  const bodySlot = partSlot();
  const editorSlot = partSlot();
  pane.append(emptySlot, frameSlot);
  const article = element('div', 'docs-article');
  article.append(headerSlot, bannerSlot, promptSlot, bodySlot, editorSlot);
  const aside = element('div', 'docs-aside');
  aside.hidden = true;
  const onThisPageSection = element('div', 'docs-aside-section');
  const linkedFromSection = element('div', 'docs-aside-section');
  const body = element('div', 'md docs-body');
  const bodyMount = createMarkdownMount(deps.markdown, deps.log);
  body.addEventListener('click', followLink);
  const editorBox = element('div', 'docs-editor');

  let drawnPane: DrawnPart | null = null;
  let drawnFrame: DrawnPart | null = null;
  let drawnAside: DrawnPart | null = null;
  // The headings and rows drawn in the right column's two sections.
  let drawnAsideRows: DrawnPart[] = [];
  let drawnEmpty: DrawnPart | null = null;
  let drawnHeader: DrawnPart | null = null;
  let drawnBanner: DrawnPart | null = null;
  let drawnPrompt: DrawnPart | null = null;
  let drawnBody: DrawnPart | null = null;
  let drawnEditorFrame: DrawnPart | null = null;
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
  // The index's entries, which Linked from reads.
  let entries: readonly IndexEntry[] = [];
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
      const placedAside = slotFor(aside, 'aside');
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

  // `data-doc` on the pane's root: no doc, a doc open, or its editor open.
  const showDocState = () => {
    root.dataset.doc =
      shown === null ? 'none' : editor === null ? 'open' : 'editing';
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

  const disposeAside = () => {
    drawnAsideRows.forEach((row) => row.dispose());
    drawnAsideRows = [];
    drawnAside?.dispose();
    drawnAside = null;
  };

  // Draws one section of the right column; hidden and undrawn with no row.
  const drawAsideSection = (
    section: HTMLElement,
    heading: AsideHeadingInput,
    rows: AsideRow[],
  ) => {
    section.hidden = rows.length === 0;
    if (rows.length === 0) {
      return;
    }
    drawnAsideRows.push(
      parts.draw('asideHeading', section, heading, (kit) => kit),
    );
    for (const row of rows) {
      const drawn = parts.draw('asideLink', section, row.input, (kit) => kit);
      drawn.element.title = row.tooltip;
      rowAction(drawn.element, row.action);
      drawnAsideRows.push(drawn);
    }
  };

  // Draws the right column for the open doc from `shownSections` and the
  // entries, at the scroll it had.
  const drawAside = () => {
    const scrollTop = aside.scrollTop;
    disposeAside();
    const doc = shown;
    if (!hasAside(doc)) {
      shownSections = [];
      aside.hidden = true;
      return;
    }
    const links = linkedFrom(entries, doc.target.path);
    if (shownSections.length === 0 && links.length === 0) {
      aside.hidden = true;
      return;
    }
    aside.hidden = false;
    let placing: AppSlot[] = [];
    drawnAside = parts.draw('pageAside', aside, {}, (kit, slotFor) => {
      const onThisPage = slotFor(onThisPageSection, 'onThisPage');
      const linked = slotFor(linkedFromSection, 'linkedFrom');
      placing = [onThisPage, linked];
      return { ...kit, onThisPage: onThisPage.place, linkedFrom: linked.place };
    });
    placeAtEnds(placing, drawnAside.element);
    const least = Math.min(...shownSections.map((section) => section.level));
    drawAsideSection(
      onThisPageSection,
      { title: ON_THIS_PAGE_TEXT, kind: 'sections' },
      shownSections.map((section) => ({
        input: { title: section.title, depth: section.level - least },
        tooltip: section.title,
        action: () => scrollToLine(section.startLine, doc.bodyStartLine),
      })),
    );
    drawAsideSection(
      linkedFromSection,
      { title: LINKED_FROM_TEXT, kind: 'linkedFrom' },
      links.map((link) => ({
        input: { title: link.title, depth: 0 },
        tooltip: deps.paths.tilde(link.path, deps.homeDir),
        action: () => deps.followFile(link.path, link.line, null),
      })),
    );
    aside.scrollTop = scrollTop;
  };

  const disposeSectionControls = () => {
    for (const { part, slot } of sectionControls) {
      part.dispose();
      slot.remove();
    }
    sectionControls = [];
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
    if (!hasAside(doc) || doc.target.readOnly !== null) {
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

  const drawBody = (rendered: Rendered) => {
    heldSection = null;
    bodyFields = rendered.fields;
    bodyMount.draw(body, rendered.html, { liveFences: rendered.liveFences });
    if (hasAside(shown)) {
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

  // Of the blocks at any depth, the one whose whole-file line is the
  // greatest at or before `line`.
  const scrollToLine = (line: number, bodyStartLine: number) => {
    const blocks = sourceBlocks(body, pane, editingSection?.hidden).filter(
      (block) => block.line + bodyStartLine - 1 <= line,
    );
    const target = blocks.reduce<{ line: number; top: number } | null>(
      (best, block) =>
        best === null || block.line >= best.line ? block : best,
      null,
    );
    pane.scrollTop = target?.top ?? 0;
  };

  // Scrolls to the heading's top, or to the section's editor while it hides
  // the heading; false when this doc has none.
  const scrollToHeading = (fragment: string): boolean => {
    const heading = body.querySelector<HTMLElement>(
      `[data-anchor="${CSS.escape(fragment)}"]`,
    );
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

  function followLink(event: MouseEvent) {
    const anchor = (event.target as Element).closest<HTMLElement>('a.md-link');
    if (anchor === null || shown === null) {
      return;
    }
    event.preventDefault();
    const href = anchor.dataset.href ?? '';
    const fromFile = shown.target.path;
    const target = resolveLink(href, fromFile, deps.homeDir, deps.paths);
    switch (target.type) {
      case 'external':
        deps.channel
          .invoke('openExternal', target.url)
          .then(() => deps.log(`opened link ${target.url}`))
          .catch((error) => deps.toast(errorText(error), 'error'));
        break;
      case 'heading':
        if (!scrollToHeading(target.fragment)) {
          toastMissingHeading(target.fragment);
        }
        break;
      case 'file':
        deps.followFile(target.path, target.line, target.fragment);
        break;
      case 'unsupported':
        deps.toast(`This link does not open here: ${target.href}`, 'info');
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
          doc.bodyStartLine = rendered.bodyStartLine;
          drawBody(rendered);
          pane.scrollTop = scrollTop;
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
    const scrollTop = pane.scrollTop;
    doc.text = diskText;
    doc.bodyStartLine = rendered.bodyStartLine;
    drawBody(rendered);
    pane.scrollTop = scrollTop;
    deps.log(`reloaded ${doc.name}`);
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
  const startEditing = (doc: ShownDoc, focusing: DocumentEditor) => {
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
    deps.log(`editing ${doc.name}`);
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
    startEditing(doc, editor);
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
    startEditing(doc, editor);
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
    if (!aside.hidden) {
      drawAside();
    }
    drawSectionControls();
  };

  const view: DocView = {
    element: root,
    async open(target) {
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
      deps.openChanged(target.path);
      removeEmpty();
      showDocState();
      showBanner(false);
      drawHeader();
      drawBody(rendered);
      pane.scrollTop = 0;
      watchFile(target.detail === null ? target.path : null, name);
      deps.log(`opened ${name}`);
      if (target.line !== null) {
        scrollToLine(target.line, rendered.bodyStartLine);
      }
      if (target.fragment !== null && !scrollToHeading(target.fragment)) {
        toastMissingHeading(target.fragment);
      }
      return true;
    },
    openPath: () => shown?.target.path ?? null,
    retarget(target) {
      const doc = shown;
      if (doc === null || isDisposed) {
        return;
      }
      doc.target = target;
      deps.openChanged(target.path);
      if (target.detail === null) {
        doc.filePath = target.path;
        doc.name = deps.paths.base(target.path);
        watchFile(target.path, doc.name);
      }
      showBanner(false);
      drawHeader();
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
            sourceBlocks(body, pane),
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
      if (!hasAside(doc)) {
        deps.toast(NOT_SECTIONED_TEXT, 'info');
        return;
      }
      const line =
        heldLine() ??
        topVisibleLine(
          sourceBlocks(body, pane),
          pane.scrollTop,
          doc.bodyStartLine,
        );
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
      const blocks = sourceBlocks(body, pane);
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
    scroll(by) {
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
        keepingFocusAndScroll(root, [pane, aside], redrawParts),
      );
    },
    dispose() {
      isDisposed = true;
      const destroying = editor;
      editor = null;
      const drawn = [
        drawnPane,
        drawnFrame,
        drawnAside,
        ...drawnAsideRows,
        drawnEmpty,
        drawnHeader,
        drawnBanner,
        drawnBody,
        drawnEditorFrame,
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
          ...drawn.map((part) => () => part?.dispose()),
        ],
        (step) => step(),
      );
    },
  };

  showDocState();
  drawPane();
  drawFrame();
  drawEmpty();
  drawBody({ fields: [], html: '', bodyStartLine: 1, liveFences: true });
  return view;
}
