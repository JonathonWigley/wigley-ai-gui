import MarkdownIt from 'markdown-it';
import type { MarkdownRenderer } from '../../contracts/markdown';

type Md = InstanceType<typeof MarkdownIt>;
type BlockRule = Parameters<Md['block']['ruler']['before']>[2];
type StateBlock = Parameters<BlockRule>[0];
type RenderRule = NonNullable<Md['renderer']['rules']['th_open']>;

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

export function createMarkdownItRenderer(): MarkdownRenderer {
  const md = new MarkdownIt({ html: false, linkify: false });
  md.disable(['link', 'image', 'autolink', 'linkify', 'reference']);
  md.set({
    highlight: (code, lang) => highlightFence(code, lang, md.utils.escapeHtml),
  });
  md.block.ruler.before('fence', 'wigley_blocks', wigleyBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  installRenderRules(md.renderer.rules);
  return {
    block: (text) => md.render(text),
    inline: (text) => md.renderInline(text),
  };
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
      pushChangeBlock(
        state,
        list[1],
        changeLines(state, startLine + 1, closeLine),
      );
      state.line = Math.min(closeLine + 1, endLine);
    }
    return true;
  }
  const details = DETAILS_OPENER.exec(text);
  if (details) {
    if (!silent) {
      const closeLine = detailsCloseLine(state, startLine, endLine);
      pushDetails(state, details[1] ?? 'Details', startLine, closeLine);
      state.line = Math.min(closeLine + 1, endLine);
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
): void {
  if (form === 'tree') {
    state.push('md_tree_open', 'ul', 1);
    pushTreeItems(state, lines);
  } else {
    state.push('md_changes_open', 'ul', 1);
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
  startLine: number,
  closeLine: number,
): void {
  state.push('md_details_open', 'details', 1);
  state.push('md_summary_open', 'summary', 1);
  pushInline(state, summary);
  state.push('md_summary_close', 'summary', -1);
  const lineMax = state.lineMax;
  // Stops a paragraph or list in the body from running past the closer.
  state.lineMax = closeLine;
  state.md.block.tokenize(state, startLine + 1, closeLine);
  state.lineMax = lineMax;
  state.push('md_details_close', 'details', -1);
}

// markdown-it's core inline rule parses every `inline` token's content later.
function pushInline(state: StateBlock, content: string): void {
  const token = state.push('inline', '', 0);
  token.content = content;
  token.children = [];
}

function installRenderRules(rules: Md['renderer']['rules']): void {
  rules.heading_open = (tokens, idx) =>
    `<p class="md-h md-${tokens[idx].tag}">`;
  rules.heading_close = () => '</p>\n';
  rules.th_open = alignedCell;
  rules.td_open = alignedCell;
  rules.md_changes_open = () => '<ul class="md-changes">';
  rules.md_tree_open = () => '<ul class="md-tree">';
  rules.md_list_close = () => '</ul>\n';
  rules.md_branch_open = () => '<ul>';
  rules.md_branch_close = () => '</ul>';
  rules.md_change_open = (tokens, idx) => changeItemOpen(tokens[idx].meta);
  rules.md_change_text_close = () => '</span>';
  rules.md_change_close = () => '</li>';
  rules.md_details_open = () => '<details class="md-details">';
  rules.md_summary_open = () => '<summary>';
  rules.md_summary_close = () => '</summary>\n';
  rules.md_details_close = () => '</details>\n';
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

// A `diff` fence colours its `+`, `-` and `~` lines; `''` keeps markdown-it's default fence.
function highlightFence(
  code: string,
  lang: string,
  escapeHtml: (text: string) => string,
): string {
  if (lang !== 'diff') {
    return '';
  }
  const lines = code
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => diffLine(line, escapeHtml));
  return `<pre class="md-diff"><code>${lines.join('\n')}</code></pre>`;
}

function diffLine(line: string, escapeHtml: (text: string) => string): string {
  const css = DIFF_CLASSES[line.charAt(0)];
  const escaped = escapeHtml(line);
  return css ? `<span class="${css}">${escaped}</span>` : escaped;
}
