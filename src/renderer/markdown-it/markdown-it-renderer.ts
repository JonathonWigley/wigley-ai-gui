import MarkdownIt from 'markdown-it';
import type { CodeHighlighter } from '../../contracts/highlight';
import type {
  FenceContribution,
  MarkdownRenderer,
} from '../../contracts/markdown';

type Md = InstanceType<typeof MarkdownIt>;
type BlockRule = Parameters<Md['block']['ruler']['before']>[2];
type StateBlock = Parameters<BlockRule>[0];
type RenderRule = NonNullable<Md['renderer']['rules']['th_open']>;
type Token = ReturnType<Md['parse']>[number];
type EscapeHtml = (text: string) => string;
type UnescapeAll = (text: string) => string;
// The registered fence contributions, keyed by their language trimmed and
// lowercased.
type Fences = Map<string, FenceContribution>;

// Per-render state of one `document` call.
type DocumentEnv = {
  slugs: Set<string>;
  highlighted: Map<Token, string | null>;
};

type ChangeKind = 'added' | 'changed' | 'removed';

interface ChangeLine {
  indent: number;
  kind: ChangeKind | null;
  text: string;
}

const LIST_OPENER = /^:::(changes|tree)$/;
const DETAILS_OPENER = /^:::details(?:\s+(.*))?$/;
const CLOSER = ':::';
const CHANGE_MARK = /^([+~x])\s+(.*)$/;
const CHANGE_BULLET = /^[-*]\s+/;
const FENCE_MARK = /^(`{3,}|~{3,})/;
const CHANGE_KINDS: Record<string, ChangeKind> = {
  '+': 'added',
  '~': 'changed',
  x: 'removed',
};
const DIFF_CLASSES: Record<string, string | undefined> = {
  '+': 'md-diff-add',
  '-': 'md-diff-del',
  '~': 'md-diff-mod',
};
const TEXT_ALIGN = 'text-align:';
const DIFF_LANGUAGE = 'diff';
const SOURCE_LINE = 'data-source-line';
const MD_LINES = 'data-md-lines';
const SLUG_DROPPED = /[^\p{L}\p{M}\p{N}\s_-]/gu;
const WHITESPACE = /\s/g;
// markdown-it's own `alt` list for its fence rule.
const FENCE_ALT = ['paragraph', 'reference', 'blockquote', 'list'];
// The links `block` and `inline` draw: web pages only.
const WEB_LINK = /^https?:\/\//i;

export function createMarkdownItRenderer(
  highlighter: CodeHighlighter,
): MarkdownRenderer {
  const fences: Fences = new Map();
  const md = createWigleyMarkdown();
  md.disable(['reference']);
  md.validateLink = isWebLink;
  md.core.ruler.after('linkify', 'web_links_only', dropNonWebLinks);
  installBlockRules(md, fences);
  const documentMd = createWigleyMarkdown();
  installDocumentRules(documentMd, fences);
  const renderer: MarkdownRenderer = {
    block: (text) => renderBlock(md, text),
    inline: (text) => md.renderInline(text),
    document: (text) => renderDocument(documentMd, highlighter, fences, text),
    addFence: (fence) => addFence(fences, fence),
    fence: (language) => fences.get(fenceKey(language)),
  };
  renderer.addFence(diffFence(md.utils.escapeHtml));
  return renderer;
}

function fenceKey(language: string): string {
  return language.trim().toLowerCase();
}

// Its Disposable removes `fence` only while it is still the one registered.
function addFence(fences: Fences, fence: FenceContribution) {
  const key = fenceKey(fence.language);
  if (fences.has(key)) {
    throw new Error(`fence ${key} is already registered`);
  }
  fences.set(key, fence);
  return {
    dispose() {
      if (fences.get(key) === fence) {
        fences.delete(key);
      }
    },
  };
}

// The built-in `diff` contribution: a `pre.md-diff` colouring its `+`, `-`
// and `~` lines.
function diffFence(escapeHtml: EscapeHtml): FenceContribution {
  return {
    language: DIFF_LANGUAGE,
    live: false,
    mount(source) {
      const element = document.createElement('pre');
      element.className = 'md-diff';
      element.innerHTML = diffCode(source, escapeHtml);
      return { element, dispose: () => undefined };
    },
  };
}

// Raw HTML escaped, bare URLs with a scheme linked, links and images drawn as
// the views expect, with the wigley blocks, table alignment classes and the
// fence's closed flag.
function createWigleyMarkdown(): Md {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
  md.block.ruler.before('fence', 'wigley_blocks', wigleyBlock, {
    alt: FENCE_ALT,
  });
  installClosedFlag(md);
  installSharedRules(md.renderer.rules, md.utils.escapeHtml);
  return md;
}

function isWebLink(url: string): boolean {
  return WEB_LINK.test(url);
}

// markdown-it keeps a link whose destination is empty (`[x]()`) even when
// `validateLink` refuses it; this leaves its text alone.
function dropNonWebLinks(state: { tokens: Token[] }): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || block.children === null) {
      continue;
    }
    const kept: Token[] = [];
    const dropsClose: boolean[] = [];
    for (const token of block.children) {
      if (token.type === 'link_open') {
        const isWeb = isWebLink(String(token.attrGet('href') ?? ''));
        dropsClose.push(!isWeb);
        if (isWeb) {
          kept.push(token);
        }
      } else if (token.type === 'link_close') {
        if (dropsClose.pop() !== true) {
          kept.push(token);
        }
      } else {
        kept.push(token);
      }
    }
    block.children = kept;
  }
}

// Wraps markdown-it's fence rule so each fence token's `meta.closed` says
// whether its closing fence is present.
function installClosedFlag(md: Md): void {
  const ruler = md.block.ruler;
  const stock = ruler.__rules__[ruler.__find__('fence')].fn;
  const withClosedFlag: BlockRule = (state, startLine, endLine, silent) => {
    const isFence = stock(state, startLine, endLine, silent);
    if (isFence && !silent) {
      const token = state.tokens[state.tokens.length - 1];
      token.meta = { closed: closesAt(state, startLine, token.markup) };
    }
    return isFence;
  };
  ruler.at('fence', withClosedFlag, { alt: FENCE_ALT });
}

// True when the fence opened at `startLine` with `markup` ended on a closing
// fence: its last line, past the opener, is a fence mark of the same kind and
// no shorter, indented less than four columns.
function closesAt(
  state: StateBlock,
  startLine: number,
  markup: string,
): boolean {
  const line = state.line - 1;
  if (line <= startLine) {
    return false;
  }
  const isIndentedCode = state.sCount[line] - state.blkIndent >= 4;
  const text = lineText(state, line);
  const mark = FENCE_MARK.exec(text)?.[1] ?? null;
  return !isIndentedCode && closesFence(markup, mark, text);
}

function renderBlock(md: Md, text: string): string {
  const env = {};
  const tokens = md.parse(text, env);
  markCursorBlocks(tokens);
  return md.renderer.render(tokens, md.options, env);
}

function markCursorBlocks(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.map !== null && isCursorBlock(token)) {
      token.attrSet(MD_LINES, `${token.map[0]},${token.map[1]}`);
    }
  }
}

// A top-level block, with a top-level list standing as its own items.
function isCursorBlock(token: Token): boolean {
  const opensOrStandsAlone = token.nesting !== -1;
  const isListOpener =
    token.type === 'bullet_list_open' || token.type === 'ordered_list_open';
  const isTopLevelBlock =
    token.level === 0 && opensOrStandsAlone && !isListOpener;
  const isTopLevelItem = token.type === 'list_item_open' && token.level === 1;
  return isTopLevelBlock || isTopLevelItem;
}

// markdown-it's `highlight` option is synchronous, so every fence is
// highlighted between parse and render; a fence the highlighter rejects
// renders plain. A contributed fence is highlighted too, inside its
// placeholder, unless its contribution is not live and so always draws.
async function renderDocument(
  md: Md,
  highlighter: CodeHighlighter,
  fences: Fences,
  text: string,
): Promise<string> {
  const env: DocumentEnv = { slugs: new Set(), highlighted: new Map() };
  const tokens = md.parse(text, env);
  markSourceLines(tokens);
  await highlightFences(tokens, highlighter, fences, md.utils.unescapeAll, env);
  return md.renderer.render(tokens, md.options, env);
}

function markSourceLines(tokens: Token[]): void {
  for (const token of tokens) {
    const opensOrStandsAlone = token.nesting !== -1;
    if (token.map !== null && opensOrStandsAlone) {
      token.attrSet(SOURCE_LINE, String(token.map[0] + 1));
    }
  }
}

async function highlightFences(
  tokens: Token[],
  highlighter: CodeHighlighter,
  contributed: Fences,
  unescapeAll: UnescapeAll,
  env: DocumentEnv,
): Promise<void> {
  const fences: { token: Token; language: string }[] = [];
  for (const token of tokens) {
    if (token.type !== 'fence') {
      continue;
    }
    const language = fenceLanguage(token, unescapeAll);
    const formatsItself = contributed.get(fenceKey(language))?.live === false;
    if (language !== '' && !formatsItself) {
      fences.push({ token, language });
    }
  }
  const results = await Promise.allSettled(
    fences.map(({ token, language }) =>
      highlighter.highlight(token.content, language),
    ),
  );
  fences.forEach(({ token }, index) =>
    env.highlighted.set(token, settledHighlight(results[index])),
  );
}

// A fence whose language failed to load renders plain, as an unknown one does.
function settledHighlight(
  result: PromiseSettledResult<string | null>,
): string | null {
  return result.status === 'fulfilled' ? result.value : null;
}

// The info string's first word, as markdown-it's own fence rule reads it.
function fenceLanguage(token: Token, unescapeAll: UnescapeAll): string {
  return unescapeAll(token.info).trim().split(/\s+/)[0];
}

// `:::changes`, `:::tree` and `:::details Summary`; a bare `:::` closes the innermost open block.
function wigleyBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const isIndentedCode = state.sCount[startLine] - state.blkIndent >= 4;
  if (isIndentedCode) {
    return false;
  }
  const text = lineText(state, startLine);
  const list = LIST_OPENER.exec(text);
  if (list) {
    if (!silent) {
      const closeLine = listCloseLine(state, startLine, endLine);
      const nextLine = Math.min(closeLine + 1, endLine);
      pushChangeBlock(
        state,
        list[1],
        changeLines(state, startLine + 1, closeLine),
        [startLine, nextLine],
      );
      state.line = nextLine;
    }
    return true;
  }
  const details = DETAILS_OPENER.exec(text);
  if (details) {
    if (!silent) {
      const closeLine = detailsCloseLine(state, startLine, endLine);
      const nextLine = Math.min(closeLine + 1, endLine);
      pushDetails(
        state,
        details[1] ?? 'Details',
        [startLine, nextLine],
        closeLine,
      );
      state.line = nextLine;
    }
    return true;
  }
  return false;
}

function lineText(state: StateBlock, line: number): string {
  return state.src
    .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
    .trim();
}

// A change or tree block holds plain lines, so its first bare `:::` closes it.
function listCloseLine(
  state: StateBlock,
  startLine: number,
  endLine: number,
): number {
  for (let line = startLine + 1; line < endLine; line++) {
    if (lineText(state, line) === CLOSER) {
      return line;
    }
  }
  return endLine;
}

// Every block opener nests one level; fenced code opens and closes nothing.
function detailsCloseLine(
  state: StateBlock,
  startLine: number,
  endLine: number,
): number {
  let depth = 1;
  let fence: string | null = null;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    const mark = FENCE_MARK.exec(text)?.[1] ?? null;
    if (fence !== null) {
      if (closesFence(fence, mark, text)) {
        fence = null;
      }
    } else if (mark !== null) {
      fence = mark;
    } else if (LIST_OPENER.test(text) || DETAILS_OPENER.test(text)) {
      depth += 1;
    } else if (text === CLOSER) {
      depth -= 1;
      if (depth === 0) {
        return line;
      }
    }
  }
  return endLine;
}

function closesFence(
  fence: string,
  mark: string | null,
  text: string,
): boolean {
  return (
    mark !== null &&
    mark[0] === fence[0] &&
    mark.length >= fence.length &&
    text.length === mark.length
  );
}

function changeLines(
  state: StateBlock,
  from: number,
  to: number,
): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (let line = from; line < to; line++) {
    const text = lineText(state, line);
    if (text !== '') {
      lines.push(parseChangeLine(text, state.sCount[line]));
    }
  }
  return lines;
}

function parseChangeLine(text: string, indent: number): ChangeLine {
  const mark = CHANGE_MARK.exec(text);
  if (mark) {
    return { indent, kind: CHANGE_KINDS[mark[1]], text: mark[2] };
  }
  return { indent, kind: null, text: text.replace(CHANGE_BULLET, '') };
}

function pushChangeBlock(
  state: StateBlock,
  form: string,
  lines: ChangeLine[],
  map: [number, number],
): void {
  if (form === 'tree') {
    state.push('md_tree_open', 'ul', 1).map = map;
    pushTreeItems(state, lines);
  } else {
    state.push('md_changes_open', 'ul', 1).map = map;
    for (const line of lines) {
      pushChangeItem(state, line);
      state.push('md_change_close', 'li', -1);
    }
  }
  state.push('md_list_close', 'ul', -1);
}

// Two spaces per level, relative to the first line; a line nests at most one level below the last.
function pushTreeItems(state: StateBlock, lines: ChangeLine[]): void {
  if (lines.length === 0) {
    return;
  }
  const baseIndent = lines[0].indent;
  let depth = 0;
  pushChangeItem(state, lines[0]);
  for (const line of lines.slice(1)) {
    const indentLevel = Math.floor(Math.max(0, line.indent - baseIndent) / 2);
    const level = Math.min(indentLevel, depth + 1);
    if (level > depth) {
      state.push('md_branch_open', 'ul', 1);
    } else {
      closeTreeItem(state, depth - level);
    }
    pushChangeItem(state, line);
    depth = level;
  }
  closeTreeItem(state, depth);
}

// Closes the open item, then `levelsUp` enclosing branches and their items.
function closeTreeItem(state: StateBlock, levelsUp: number): void {
  state.push('md_change_close', 'li', -1);
  for (let level = 0; level < levelsUp; level++) {
    state.push('md_branch_close', 'ul', -1);
    state.push('md_change_close', 'li', -1);
  }
}

function pushChangeItem(state: StateBlock, line: ChangeLine): void {
  state.push('md_change_open', 'li', 1).meta = { kind: line.kind };
  pushInline(state, line.text);
  state.push('md_change_text_close', 'span', 0);
}

function pushDetails(
  state: StateBlock,
  summary: string,
  map: [number, number],
  closeLine: number,
): void {
  state.push('md_details_open', 'details', 1).map = map;
  state.push('md_summary_open', 'summary', 1);
  pushInline(state, summary);
  state.push('md_summary_close', 'summary', -1);
  const lineMax = state.lineMax;
  // Stops a paragraph or list in the body from running past the closer.
  state.lineMax = closeLine;
  state.md.block.tokenize(state, map[0] + 1, closeLine);
  state.lineMax = lineMax;
  state.push('md_details_close', 'details', -1);
}

// markdown-it's core inline rule parses every `inline` token's content later.
function pushInline(state: StateBlock, content: string): void {
  const token = state.push('inline', '', 0);
  token.content = content;
  token.children = [];
}

// A link is an anchor whose click the page handles from its `data-href`, and
// an image is its alt text.
function installSharedRules(
  rules: Md['renderer']['rules'],
  escapeHtml: EscapeHtml,
): void {
  rules.link_open = (tokens, idx) => {
    const token = tokens[idx];
    const href = String(token.attrGet('href') ?? '');
    const title = String(token.attrGet('title') ?? href);
    return `<a class="md-link" href="#" data-href="${escapeHtml(href)}" title="${escapeHtml(title)}">`;
  };
  rules.image = (tokens, idx, options, env, self) => {
    const alt = self.renderInlineAsText(
      tokens[idx].children ?? [],
      options,
      env,
    );
    return `<span class="md-image">${escapeHtml(alt)}</span>`;
  };
  rules.th_open = alignedCell;
  rules.td_open = alignedCell;
  rules.md_changes_open = openTagWithAttrs('<ul class="md-changes"');
  rules.md_tree_open = openTagWithAttrs('<ul class="md-tree"');
  rules.md_list_close = () => '</ul>\n';
  rules.md_branch_open = () => '<ul>';
  rules.md_branch_close = () => '</ul>';
  rules.md_change_open = (tokens, idx) => changeItemOpen(tokens[idx].meta);
  rules.md_change_text_close = () => '</span>';
  rules.md_change_close = () => '</li>';
  rules.md_details_open = openTagWithAttrs('<details class="md-details"');
  rules.md_summary_open = () => '<summary>';
  rules.md_summary_close = () => '</summary>\n';
  rules.md_details_close = () => '</details>\n';
}

// `tagStart` is the open tag up to its token's attributes and closing `>`.
function openTagWithAttrs(tagStart: string): RenderRule {
  return (tokens, idx, _options, _env, self) =>
    `${tagStart}${self.renderAttrs(tokens[idx])}>`;
}

function installBlockRules(md: Md, fences: Fences): void {
  const rules = md.renderer.rules;
  rules.heading_open = (tokens, idx, _options, _env, self) =>
    `<p class="md-h md-${tokens[idx].tag}"${self.renderAttrs(tokens[idx])}>`;
  rules.heading_close = () => '</p>\n';
  const { escapeHtml } = md.utils;
  installFenceRule(
    md,
    fences,
    (token) => escapeHtml(token.content),
    linesMarkOnPre(rules.fence!),
  );
}

// markdown-it's fence rule prints a token's attributes on `<code>`.
function linesMarkOnPre(stock: RenderRule): RenderRule {
  return (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lines = token.attrGet(MD_LINES);
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== MD_LINES);
    const html = stock(tokens, idx, options, env, self);
    return lines === null
      ? html
      : html.replace('<pre', `<pre ${MD_LINES}="${lines}"`);
  };
}

// A fence whose language has a contribution renders as the markdown mount's
// placeholder, its code as `codeOf` gives it; any other renders through
// `uncontributed`.
function installFenceRule(
  md: Md,
  fences: Fences,
  codeOf: (token: Token, env: unknown) => string,
  uncontributed: RenderRule,
): void {
  const { escapeHtml, unescapeAll } = md.utils;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = fenceKey(fenceLanguage(token, unescapeAll));
    if (!fences.has(language)) {
      return uncontributed(tokens, idx, options, env, self);
    }
    const shownLanguage = escapeHtml(language);
    const closed = token.meta?.closed === true;
    return (
      `<div class="md-fence" data-fence-language="${shownLanguage}" data-fence-closed="${closed}"${self.renderAttrs(token)}>` +
      `<pre><code class="${options.langPrefix}${shownLanguage}">${codeOf(token, env)}</code></pre></div>\n`
    );
  };
}

function installDocumentRules(md: Md, fences: Fences): void {
  const { escapeHtml, unescapeAll } = md.utils;
  const rules = md.renderer.rules;
  // Every render of this instance goes through `renderDocument`'s env.
  rules.heading_open = (tokens, idx, _options, env, self) => {
    const token = tokens[idx];
    const { slugs } = env as DocumentEnv;
    const slug = uniqueSlug(headingSlug(tokens[idx + 1]), slugs);
    return `<${token.tag} data-anchor="${slug}"${self.renderAttrs(token)}>`;
  };
  const codeOf = (token: Token, env: unknown) =>
    (env as DocumentEnv).highlighted.get(token) ?? escapeHtml(token.content);
  installFenceRule(md, fences, codeOf, (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = fenceLanguage(token, unescapeAll);
    const attrs = self.renderAttrs(token);
    const languageClass =
      language === ''
        ? ''
        : ` class="${options.langPrefix}${escapeHtml(language)}"`;
    return `<pre${attrs}><code${languageClass}>${codeOf(token, env)}</code></pre>\n`;
  });
}

// GitHub's slug: the heading's plain text, lowercased, with every character but
// letters, marks, numbers, spaces, `_` and `-` removed and each space a `-`.
function headingSlug(inline: Token): string {
  const text = (inline.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('');
  return text.toLowerCase().replace(SLUG_DROPPED, '').replace(WHITESPACE, '-');
}

// A slug already taken in the document gets `-1`, then `-2`, … .
function uniqueSlug(slug: string, taken: Set<string>): string {
  let unique = slug;
  for (let count = 1; taken.has(unique); count++) {
    unique = `${slug}-${count}`;
  }
  taken.add(unique);
  return unique;
}

function changeItemOpen(meta: Record<string, unknown> | null): string {
  const kind = meta?.kind;
  const text = '<span class="md-change-text">';
  if (typeof kind !== 'string') {
    return `<li class="md-change">${text}`;
  }
  return `<li class="md-change ${kind}"><span class="md-pill">${kind}</span>${text}`;
}

// markdown-it aligns a cell with `style="text-align:…"`; this swaps it for an `md-…` class.
const alignedCell: RenderRule = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const style = token.attrGet('style');
  if (typeof style === 'string' && style.startsWith(TEXT_ALIGN)) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `md-${style.slice(TEXT_ALIGN.length)}`);
  }
  return self.renderToken(tokens, idx, options);
};

function diffCode(code: string, escapeHtml: EscapeHtml): string {
  const lines = code
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => diffLine(line, escapeHtml));
  return `<code>${lines.join('\n')}</code>`;
}

function diffLine(line: string, escapeHtml: EscapeHtml): string {
  const css = DIFF_CLASSES[line.charAt(0)];
  const escaped = escapeHtml(line);
  return css ? `<span class="${css}">${escaped}</span>` : escaped;
}
