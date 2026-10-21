import type {
  DocumentEditor,
  DocumentEditorEvents,
  EditorHost,
} from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element, markdownElement } from '../../../shared/page/dom';
import type { DocsChannel } from '../contract';
import { baseName, tildePath } from '../doc-paths';
import { splitFrontmatter } from '../frontmatter';
import { resolveLink } from '../links';
import { type Chip, codeFence, topVisibleLine } from './docs-state';

export const UNSAVED_TEXT = 'Unsaved changes — :w to save, :q! to discard';
const CONFLICT_TEXT =
  'File changed on disk — r reload, o overwrite, Esc cancel';
const BANNER_TEXT = 'Changed on disk since you opened it';
const SCROLL_STEP_PX = 48;

// The plugin cache line, shown under the header and toasted on `i`.
export function readOnlyText(plugin: string): string {
  return `Plugin cache — ${plugin}. Edit the source repo's copy.`;
}

// What the doc pane opens.
export interface DocTarget {
  path: string;
  title: string;
  // The entry whose chips show; null for a file no entry names.
  entryId: string | null;
  // A hook or plugin entry: the header only, no file read or watched.
  isHeaderOnly: boolean;
  // The plugin whose cache holds the file, which makes it read-only.
  cachePlugin: string | null;
  // 1-based line of the whole file to scroll to.
  line: number | null;
  // A heading anchor to scroll to, after `line`.
  fragment: string | null;
}

export interface DocViewDeps {
  viewId: string;
  channel: PageChannel<DocsChannel>;
  homeDir: Promise<string>;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  chipsOf(entryId: string): { claude: Chip; codex: Chip };
  // Opens a file a link leads to in this view.
  followFile(path: string, line: number | null, fragment: string | null): void;
  // Pushes `docs.conflict` while the changed-on-disk prompt shows.
  pushConflictScope(): PushedScope;
}

// The doc pane: the header with its chips, the plugin cache line, the
// frontmatter table and the rendered body, swapped for the document editor
// on `edit`. Opening another doc is refused while the editor holds unsaved
// edits. `open` resolves to whether the doc opened.
export interface DocView {
  element: HTMLElement;
  open(target: DocTarget): Promise<boolean>;
  openPath(): string | null;
  refreshChips(): void;
  diskChanged(path: string): void;
  edit(): void;
  scroll(by: 1 | -1): void;
  // Focuses the open editor, else the pane.
  focus(): void;
  hasUnsavedEdits(): boolean;
  // Toasts and logs the refusal when the editor holds unsaved edits.
  refuseWithUnsavedEdits(): boolean;
  conflictReload(): void;
  conflictOverwrite(): void;
  conflictCancel(): void;
  dispose(): void;
}

interface Rendered {
  fields: [string, string][];
  html: string;
  bodyStartLine: number;
}

interface ShownDoc {
  target: DocTarget;
  name: string;
  // The file text the view last read or wrote.
  text: string;
  bodyStartLine: number;
}

type AfterWrite = 'stay' | 'close';

interface Conflict {
  diskText: string;
  after: AfterWrite;
  scope: PushedScope;
}

// A markdown file renders its body under its frontmatter; any other file
// renders as one fenced block in its extension's language.
async function renderText(
  markdown: MarkdownRenderer,
  path: string,
  text: string,
): Promise<Rendered> {
  if (path.endsWith('.md')) {
    const split = splitFrontmatter(text);
    const html = await markdown.document(split.body);
    return { fields: split.fields, html, bodyStartLine: split.bodyStartLine };
  }
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  const language = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  const fence = codeFence(text);
  const html = await markdown.document(
    `${fence}${language}\n${text}\n${fence}`,
  );
  return { fields: [], html, bodyStartLine: 1 };
}

function frontmatterTable(fields: [string, string][]): HTMLElement {
  const box = element('div', 'docs-frontmatter-box');
  box.hidden = fields.length === 0;
  const table = element('table', 'docs-frontmatter');
  for (const [key, value] of fields) {
    const row = element('tr');
    row.append(element('th', '', key), element('td', '', value));
    table.append(row);
  }
  box.append(table);
  return box;
}

function chipElement(chip: Chip): HTMLElement {
  const node = element('span', 'docs-chip', chip.text);
  node.dataset.state = chip.state;
  node.title = chip.tooltip;
  return node;
}

// The rendered blocks' source lines and tops, measured from the pane.
function sourceBlocks(body: HTMLElement): { line: number; top: number }[] {
  return [...body.querySelectorAll<HTMLElement>('[data-source-line]')].map(
    (block) => ({
      line: Number(block.dataset.sourceLine),
      top: block.offsetTop,
    }),
  );
}

export function createDocView(deps: DocViewDeps): DocView {
  const pane = element('div', 'docs-doc');
  pane.tabIndex = -1;
  const header = element('div', 'docs-header');
  const title = element('h1', 'docs-title');
  const path = element('div', 'docs-path');
  const chipRow = element('div', 'docs-chips');
  header.append(title, path, chipRow);
  const readOnlyLine = element('div', 'docs-readonly');
  const banner = element('div', 'docs-banner', BANNER_TEXT);
  const prompt = element('div', 'docs-prompt', CONFLICT_TEXT);
  let frontmatter = frontmatterTable([]);
  let body = markdownElement('div', 'md docs-body', '');
  header.hidden = true;
  readOnlyLine.hidden = true;
  banner.hidden = true;
  prompt.hidden = true;
  pane.append(header, readOnlyLine, banner, prompt, frontmatter, body);

  let shown: ShownDoc | null = null;
  let editor: DocumentEditor | null = null;
  let editorBox: HTMLElement | null = null;
  let conflict: Conflict | null = null;
  // The text a write in flight sends: the watch it fires is the view's own.
  let writingText: string | null = null;
  let openCount = 0;
  let isDisposed = false;

  const drawChips = () => {
    const entryId = shown?.target.entryId ?? null;
    if (entryId === null) {
      chipRow.replaceChildren();
      return;
    }
    const { claude, codex } = deps.chipsOf(entryId);
    chipRow.replaceChildren(chipElement(claude), chipElement(codex));
  };

  const drawBody = (rendered: Rendered) => {
    const nextFrontmatter = frontmatterTable(rendered.fields);
    const nextBody = markdownElement('div', 'md docs-body', rendered.html);
    nextBody.addEventListener('click', followLink);
    frontmatter.replaceWith(nextFrontmatter);
    body.replaceWith(nextBody);
    frontmatter = nextFrontmatter;
    body = nextBody;
  };

  const drawHeader = (target: DocTarget, homeDir: string) => {
    header.hidden = false;
    title.textContent = target.title;
    path.textContent = tildePath(target.path, homeDir);
    path.title = target.path;
    readOnlyLine.hidden = target.cachePlugin === null;
    readOnlyLine.textContent =
      target.cachePlugin === null ? '' : readOnlyText(target.cachePlugin);
    banner.hidden = true;
  };

  // Of the blocks at any depth, the one whose whole-file line is the
  // greatest at or before `line`.
  const scrollToLine = (line: number, bodyStartLine: number) => {
    const blocks = sourceBlocks(body).filter(
      (block) => block.line + bodyStartLine - 1 <= line,
    );
    const target = blocks.reduce<{ line: number; top: number } | null>(
      (best, block) =>
        best === null || block.line >= best.line ? block : best,
      null,
    );
    pane.scrollTop = target?.top ?? 0;
  };

  // Scrolls to the heading's top; false when this doc has none.
  const scrollToHeading = (fragment: string): boolean => {
    const heading = body.querySelector<HTMLElement>(
      `[data-anchor="${CSS.escape(fragment)}"]`,
    );
    if (heading === null) {
      return false;
    }
    pane.scrollTop = heading.offsetTop;
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
    void deps.homeDir.then((homeDir) => {
      const target = resolveLink(href, fromFile, homeDir);
      switch (target.type) {
        case 'external':
          deps.channel
            .invoke('openExternal', target.url)
            .then(() => deps.log('docs', `opened link ${target.url}`))
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
    });
  }

  const endConflict = (refocus: boolean) => {
    if (conflict === null) {
      return;
    }
    conflict.scope.pop();
    conflict = null;
    prompt.hidden = true;
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
    prompt.hidden = false;
  };

  // Destroys the editor and shows the rendered doc from the text last read
  // or written.
  const closeEditor = (doc: ShownDoc) => {
    endConflict(false);
    editor?.destroy();
    editor = null;
    editorBox?.remove();
    editorBox = null;
    pane.classList.remove('is-editing');
    banner.hidden = true;
    deps.log('docs', `closed the editor on ${doc.name}`);
    pane.focus();
    renderText(deps.markdown, doc.target.path, doc.text)
      .then((rendered) => {
        if (shown === doc && editor === null) {
          doc.bodyStartLine = rendered.bodyStartLine;
          drawBody(rendered);
        }
      })
      .catch((error) => deps.log('docs', `not rendered: ${errorText(error)}`));
  };

  const writeEditor = (overwrite: boolean, after: AfterWrite) => {
    const doc = shown;
    const writing = editor;
    if (doc === null || writing === null) {
      return;
    }
    const text = writing.text();
    writingText = text;
    deps.channel
      .invoke('writeDoc', doc.target.path, text, overwrite ? null : doc.text)
      .then((result) => {
        if (shown !== doc || editor !== writing) {
          return;
        }
        if (result.type === 'changedOnDisk') {
          showConflict(result.diskText, after);
          return;
        }
        doc.text = text;
        banner.hidden = true;
        deps.toast(`Wrote ${doc.name}`, 'success');
        deps.log('docs', `wrote ${doc.name}`);
        if (after === 'close') {
          closeEditor(doc);
        }
      })
      .catch((error) => {
        deps.toast(errorText(error), 'error');
        deps.log('docs', `not written ${doc.name}: ${errorText(error)}`);
      })
      .finally(() => {
        writingText = null;
      });
  };

  const quitEditor = (force: boolean) => {
    if (shown === null || editor === null) {
      return;
    }
    const hasUnsaved = editor.text() !== shown.text;
    if (hasUnsaved && !force) {
      deps.toast(UNSAVED_TEXT, 'error');
      deps.log('docs', `refused :q with unsaved edits on ${shown.name}`);
      return;
    }
    if (hasUnsaved) {
      deps.log('docs', `dropped edits on ${shown.name}`);
    }
    closeEditor(shown);
  };

  const editorEvents: DocumentEditorEvents = {
    changed: () => undefined,
    write: () => writeEditor(false, 'stay'),
    quit: quitEditor,
    writeQuit: () => writeEditor(false, 'close'),
    modeChanged: () => undefined,
  };

  const reread = async (doc: ShownDoc) => {
    const diskText = await deps.channel.invoke('readDoc', doc.target.path);
    if (shown !== doc || diskText === writingText) {
      return;
    }
    if (editor !== null) {
      if (diskText !== doc.text) {
        banner.hidden = false;
        deps.log('docs', `changed on disk: ${doc.name}`);
      }
      return;
    }
    const rendered = await renderText(deps.markdown, doc.target.path, diskText);
    if (shown !== doc || editor !== null) {
      return;
    }
    const scrollTop = pane.scrollTop;
    doc.text = diskText;
    doc.bodyStartLine = rendered.bodyStartLine;
    drawBody(rendered);
    pane.scrollTop = scrollTop;
    deps.log('docs', `reloaded ${doc.name}`);
  };

  const view: DocView = {
    element: pane,
    async open(target) {
      if (view.refuseWithUnsavedEdits()) {
        return false;
      }
      const count = ++openCount;
      let text = '';
      let rendered: Rendered = { fields: [], html: '', bodyStartLine: 1 };
      const homeDir = await deps.homeDir;
      try {
        if (!target.isHeaderOnly) {
          text = await deps.channel.invoke('readDoc', target.path);
          rendered = await renderText(deps.markdown, target.path, text);
        }
      } catch (error) {
        const failure = `Could not open ${tildePath(target.path, homeDir)}: ${errorText(error)}`;
        deps.toast(failure, 'error');
        deps.log('docs', failure);
        return false;
      }
      if (count !== openCount || isDisposed || view.hasUnsavedEdits()) {
        return false;
      }
      if (shown !== null && editor !== null) {
        closeEditor(shown);
      }
      const name = baseName(target.path);
      shown = { target, name, text, bodyStartLine: rendered.bodyStartLine };
      drawHeader(target, homeDir);
      drawChips();
      drawBody(rendered);
      pane.scrollTop = 0;
      deps.channel
        .invoke(
          'watchDoc',
          deps.viewId,
          target.isHeaderOnly ? null : target.path,
        )
        .catch((error) =>
          deps.log('docs', `not watching ${name}: ${errorText(error)}`),
        );
      deps.log('docs', `opened ${name}`);
      if (target.line !== null) {
        scrollToLine(target.line, rendered.bodyStartLine);
      }
      if (target.fragment !== null && !scrollToHeading(target.fragment)) {
        toastMissingHeading(target.fragment);
      }
      return true;
    },
    openPath: () => shown?.target.path ?? null,
    refreshChips: drawChips,
    diskChanged(changedPath) {
      const doc = shown;
      if (doc === null || doc.target.isHeaderOnly) {
        return;
      }
      if (doc.target.path !== changedPath) {
        return;
      }
      reread(doc).catch((error) =>
        deps.log('docs', `not reloaded ${doc.name}: ${errorText(error)}`),
      );
    },
    edit() {
      const doc = shown;
      if (doc === null || doc.target.isHeaderOnly) {
        return;
      }
      if (doc.target.cachePlugin !== null) {
        deps.toast(readOnlyText(doc.target.cachePlugin), 'info');
        return;
      }
      if (editor !== null) {
        editor.focus();
        return;
      }
      const line = topVisibleLine(
        sourceBlocks(body),
        pane.scrollTop,
        doc.bodyStartLine,
      );
      pane.classList.add('is-editing');
      pane.scrollTop = 0;
      editorBox = element('div', 'docs-editor');
      pane.append(editorBox);
      editor = deps.editor.createDocument(
        editorBox,
        doc.text,
        { fileName: doc.name, readOnly: false, line },
        editorEvents,
      );
      editor.focus();
      deps.log('docs', `editing ${doc.name}`);
    },
    scroll(by) {
      pane.scrollTop += by * SCROLL_STEP_PX;
    },
    focus() {
      if (editor !== null) {
        editor.focus();
      } else {
        pane.focus();
      }
    },
    hasUnsavedEdits: () =>
      editor !== null && shown !== null && editor.text() !== shown.text,
    refuseWithUnsavedEdits() {
      if (!view.hasUnsavedEdits()) {
        return false;
      }
      deps.toast(UNSAVED_TEXT, 'error');
      deps.log('docs', `refused to leave ${shown?.name} with unsaved edits`);
      return true;
    },
    conflictReload() {
      const held = conflict;
      if (held === null || editor === null || shown === null) {
        return;
      }
      endConflict(true);
      editor.setText(held.diskText);
      shown.text = held.diskText;
      banner.hidden = true;
      deps.log('docs', `reloaded ${shown.name}`);
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
      endConflict(true);
    },
    dispose() {
      isDisposed = true;
      endConflict(false);
      editor?.destroy();
      editor = null;
      deps.channel
        .invoke('watchDoc', deps.viewId, null)
        .catch((error) =>
          deps.log('docs', `watch not stopped: ${errorText(error)}`),
        );
    },
  };
  return view;
}
