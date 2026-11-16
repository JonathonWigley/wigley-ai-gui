import MarkdownIt from 'markdown-it';
import type { CodeHighlighter } from '../../contracts/highlight';
import type {
  BlockContribution,
  BlockHelpers,
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
// The registered block contributions, keyed by their exact name.
type Blocks = Map<string, BlockContribution>;

// Per-render state of one `document` call.
type DocumentEnv = {
  slugs: Set<string>;
  highlighted: Map<Token, string | null>;
};

// A line that opens a registered block, and the header after its name.
interface BlockOpener {
  contribution: BlockContribution;
  header: string;
}

// What one `helpers.block` or `helpers.inline` call asked `render` to draw.
interface BlockRequest {
  kind: 'block' | 'inline';
  text: string;
}

const BLOCK_OPENER = /^:::([a-z][a-z0-9-]*)(?:\s+(.*))?$/;
const BLOCK_NAME = /^[a-z][a-z0-9-]*$/;
const CLOSER = ':::';
// A request's marker is its index between two of these. markdown-it's
// normalize step turns every NUL in the source into U+FFFD, so no source text
// holds one.
const MARKER_EDGE = '\u0000';
const OPENS_WITH_TAG = /^<[A-Za-z]/;
const FENCE_MARK = /^(`{3,}|~{3,})/;
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
  const blocks: Blocks = new Map();
  const md = createWigleyMarkdown(blocks);
  md.disable(['reference']);
  md.validateLink = isWebLink;
  md.core.ruler.after('linkify', 'web_links_only', dropNonWebLinks);
  installBlockRules(md, fences);
  const documentMd = createWigleyMarkdown(blocks);
  installDocumentRules(documentMd, fences);
  const renderer: MarkdownRenderer = {
    block: (text) => renderBlock(md, text),
    inline: (text) => md.renderInline(text),
    document: (text) => renderDocument(documentMd, highlighter, fences, text),
    addFence: (fence) => addFence(fences, fence),
    fence: (language) => fences.get(fenceKey(language)),
    addBlock: (block) => addBlock(blocks, block),
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

// Its Disposable removes `block` only while it is still the one registered.
function addBlock(blocks: Blocks, block: BlockContribution) {
  const { name } = block;
  if (!BLOCK_NAME.test(name)) {
    throw new Error(`block name "${name}" must match [a-z][a-z0-9-]*`);
  }
  if (blocks.has(name)) {
    throw new Error(`block ${name} is already registered`);
  }
  blocks.set(name, block);
  return {
    dispose() {
      if (blocks.get(name) === block) {
        blocks.delete(name);
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
// the views expect, with each block in `blocks` as it holds them at parse time,
// table alignment classes and the fence's closed flag.
function createWigleyMarkdown(blocks: Blocks): Md {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
  const blockRule: BlockRule = (state, startLine, endLine, silent) =>
    contributedBlock(blocks, state, startLine, endLine, silent);
  md.block.ruler.before('fence', 'contributed_blocks', blockRule, {
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

// A registered `:::name header` block, from its opener to the bare `:::` that
// closes it, or to `endLine`. Its `render` runs once, here at parse time; the
// tokens its HTML and helper requests make are pushed in the HTML's order.
function contributedBlock(
  blocks: Blocks,
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const opener = blockOpener(blocks, state, startLine);
  if (opener === null) {
    return false;
  }
  if (silent) {
    return true;
  }
  const closeLine = blockCloseLine(blocks, state, startLine, endLine);
  const nextLine = Math.min(closeLine + 1, endLine);
  const map: [number, number] = [startLine, nextLine];
  const body = bodyLines(state, startLine + 1, closeLine);
  const requests: BlockRequest[] = [];
  const helpers: BlockHelpers = {
    block: (text) => requestMarker(requests, 'block', text),
    inline: (text) => requestMarker(requests, 'inline', text),
    escape: (text) => state.md.utils.escapeHtml(text),
  };
  const html = renderedOrNull(opener, body, helpers);
  if (html === null) {
    pushBlockAsText(state, startLine, closeLine);
  } else {
    pushBlockTokens(state, html, map, requests, (request) =>
      pushRequest(state, request, body, startLine + 1),
    );
  }
  state.line = nextLine;
  return true;
}

// Null when the contribution's `render` throws: a plugin's bug draws its block
// as text rather than failing the whole render.
function renderedOrNull(
  opener: BlockOpener,
  body: readonly string[],
  helpers: BlockHelpers,
): string | null {
  try {
    return opener.contribution.render({ header: opener.header, body }, helpers);
  } catch {
    return null;
  }
}

// Indented code (four columns past the block indent) opens nothing, and nor
// does a name no block registered.
function blockOpener(
  blocks: Blocks,
  state: StateBlock,
  line: number,
): BlockOpener | null {
  const isIndentedCode = state.sCount[line] - state.blkIndent >= 4;
  if (isIndentedCode) {
    return null;
  }
  const match = BLOCK_OPENER.exec(lineText(state, line));
  const contribution = match === null ? undefined : blocks.get(match[1]);
  if (match === null || contribution === undefined) {
    return null;
  }
  return { contribution, header: (match[2] ?? '').trim() };
}

function requestMarker(
  requests: BlockRequest[],
  kind: BlockRequest['kind'],
  text: string,
): string {
  const index = requests.push({ kind, text }) - 1;
  return `${MARKER_EDGE}${index}${MARKER_EDGE}`;
}

// Each line's trimmed text behind one space per column past the block indent.
function bodyLines(state: StateBlock, from: number, to: number): string[] {
  const lines: string[] = [];
  for (let line = from; line < to; line++) {
    const text = lineText(state, line);
    const indent = Math.max(0, state.sCount[line] - state.blkIndent);
    lines.push(text === '' ? '' : ' '.repeat(indent) + text);
  }
  return lines;
}

function lineText(state: StateBlock, line: number): string {
  return state.src
    .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
    .trim();
}

// Every block opener nests one level and a bare `:::` closes the innermost;
// fenced code opens and closes nothing. `endLine` when no line closes it.
function blockCloseLine(
  blocks: Blocks,
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
    } else if (blockOpener(blocks, state, line) !== null) {
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

// `md_block_open` holds the HTML before the first marker and `md_block_close`
// the HTML after the last; between two markers an `md_block_html` holds the
// HTML between them. Each marker pushes its request's tokens, a marker that
// names no request nothing.
function pushBlockTokens(
  state: StateBlock,
  html: string,
  map: [number, number],
  requests: readonly BlockRequest[],
  pushRequest: (request: BlockRequest) => void,
): void {
  // Each marker's index lands at an odd place, its HTML around it.
  const parts = html.split(MARKER_EDGE);
  const open = state.push('md_block_open', '', 1);
  open.content = parts[0];
  open.map = map;
  for (let place = 1; place < parts.length; place += 2) {
    const request = requests[Number(parts[place])];
    if (request !== undefined) {
      pushRequest(request);
    }
    const isLastHtml = place + 1 === parts.length - 1;
    if (!isLastHtml) {
      state.push('md_block_html', '', 0).content = parts[place + 1];
    }
  }
  state.push('md_block_close', '', -1).content = parts[parts.length - 1];
}

// A `block` request for a run of whole body lines tokenizes those source lines
// in place, so each token keeps its source line; any other text parses on its
// own, with no source lines.
function pushRequest(
  state: StateBlock,
  request: BlockRequest,
  body: readonly string[],
  firstBodyLine: number,
): void {
  if (request.kind === 'inline') {
    pushInline(state, request.text);
    return;
  }
  if (request.text === '') {
    return;
  }
  const run = bodyRun(body, request.text);
  if (run === null) {
    pushParsedBlock(state, request.text);
  } else {
    pushLinesInPlace(state, firstBodyLine + run[0], firstBodyLine + run[1]);
  }
}

// The smallest `from`, then the smallest `to`, for which `body`'s lines
// `from` up to `to` joined by newlines are `text`; null when none are.
function bodyRun(
  body: readonly string[],
  text: string,
): [number, number] | null {
  for (let from = 0; from < body.length; from++) {
    let joined = body[from];
    for (let to = from + 1; to <= body.length; to++) {
      if (joined === text) {
        return [from, to];
      }
      if (to === body.length || joined.length >= text.length) {
        break;
      }
      joined += `\n${body[to]}`;
    }
  }
  return null;
}

// markdown-it 15.0.3: `ParserBlock.tokenize(state, startLine, endLine)` runs
// the block rules over the state's own lines, pushing onto its tokens.
function pushLinesInPlace(state: StateBlock, from: number, to: number): void {
  const lineMax = state.lineMax;
  // Stops a paragraph or list in the run from running past its last line.
  state.lineMax = to;
  state.md.block.tokenize(state, from, to);
  state.lineMax = lineMax;
}

// markdown-it 15.0.3: `ParserBlock.parse(src, md, env, outTokens)` runs the
// block rules alone over a new state, so each inline token's children stay
// empty for the core inline pass to fill once.
function pushParsedBlock(state: StateBlock, text: string): void {
  const tokens: Token[] = [];
  state.md.block.parse(text, state.md, state.env, tokens);
  for (const token of tokens) {
    token.map = null;
    token.level += state.level;
    state.tokens.push(token);
  }
}

// What a block whose `render` threw draws: each non-blank line from its opener
// up to its close line as an escaped paragraph.
function pushBlockAsText(
  state: StateBlock,
  startLine: number,
  closeLine: number,
): void {
  const { escapeHtml } = state.md.utils;
  let html = '';
  for (let line = startLine; line < closeLine; line++) {
    const text = lineText(state, line);
    if (text !== '') {
      html += `<p>${escapeHtml(text)}</p>\n`;
    }
  }
  state.push('md_block_html', '', 0).content = html;
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
  rules.md_block_open = blockOpenWithAttrs;
  rules.md_block_html = (tokens, idx) => tokens[idx].content;
  rules.md_block_close = (tokens, idx) => tokens[idx].content;
}

// A block's HTML before its first marker, with the token's attributes put in
// front of the first `>` when it opens with a tag.
const blockOpenWithAttrs: RenderRule = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx];
  const html = token.content;
  const tagEnd = html.indexOf('>');
  if (!OPENS_WITH_TAG.test(html) || tagEnd === -1) {
    return html;
  }
  return `${html.slice(0, tagEnd)}${self.renderAttrs(token)}${html.slice(tagEnd)}`;
};

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
