import type {
  BlockContribution,
  BlockHelpers,
} from '../../../contracts/markdown';

type ChangeKind = 'added' | 'changed' | 'removed';

interface ChangeLine {
  indent: number;
  kind: ChangeKind | null;
  text: string;
}

const CHANGE_MARK = /^([+~x])\s+(.*)$/;
const CHANGE_BULLET = /^[-*]\s+/;
const CHANGE_KINDS: Record<string, ChangeKind> = {
  '+': 'added',
  '~': 'changed',
  x: 'removed',
};

// `:::changes`: one row per non-blank line, a `+`, `~` or `x` mark drawn as an
// added, changed or removed pill and a `-` or `*` bullet as a plain row. The
// header is ignored.
export const changesBlock: BlockContribution = {
  name: 'changes',
  render({ body }, helpers) {
    const items = changeLines(body).map(
      (line) => `${changeItemOpen(line, helpers)}</li>`,
    );
    return `<ul class="md-changes">${items.join('')}</ul>\n`;
  },
};

// `:::tree`: the rows of `:::changes`, nested by indent. The header is ignored.
export const treeBlock: BlockContribution = {
  name: 'tree',
  render({ body }, helpers) {
    return `<ul class="md-tree">${treeItems(changeLines(body), helpers)}</ul>\n`;
  },
};

function changeLines(body: readonly string[]): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const line of body) {
    if (line !== '') {
      const text = line.trimStart();
      lines.push(parseChangeLine(text, line.length - text.length));
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

// Two spaces per level, relative to the first line; a line nests at most one level below the last.
function treeItems(lines: ChangeLine[], helpers: BlockHelpers): string {
  if (lines.length === 0) {
    return '';
  }
  const baseIndent = lines[0].indent;
  let depth = 0;
  let html = changeItemOpen(lines[0], helpers);
  for (const line of lines.slice(1)) {
    const indentLevel = Math.floor(Math.max(0, line.indent - baseIndent) / 2);
    const level = Math.min(indentLevel, depth + 1);
    html += level > depth ? '<ul>' : closeTreeItem(depth - level);
    html += changeItemOpen(line, helpers);
    depth = level;
  }
  return html + closeTreeItem(depth);
}

// Closes the open item, then `levelsUp` enclosing branches and their items.
function closeTreeItem(levelsUp: number): string {
  return `</li>${'</ul></li>'.repeat(levelsUp)}`;
}

// An item's open tag, its pill and its text, left open for a branch to nest in.
function changeItemOpen(line: ChangeLine, helpers: BlockHelpers): string {
  const text = `<span class="md-change-text">${helpers.inline(line.text)}</span>`;
  if (line.kind === null) {
    return `<li class="md-change">${text}`;
  }
  return `<li class="md-change ${line.kind}"><span class="md-pill">${line.kind}</span>${text}`;
}
