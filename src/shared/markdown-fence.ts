// One step over a markdown file's fences, the rule of `markdown.py`'s
// `_lines_outside_fences`: the open fence's run after `line`, null when none is
// open. `pattern` captures a line's leading fence run and the text after it, its
// flags the caller's own reading of the line. Any indent counts, so a fence
// inside a list item counts. A line outside fenced code is one with no fence
// open before it or after it.
export function fenceAfterLine(
  line: string,
  fence: string | null,
  pattern: RegExp,
): string | null {
  const run = pattern.exec(line.trimStart());
  if (run === null) {
    return fence;
  }
  if (fence === null) {
    return isInlineCode(run) ? null : run[1];
  }
  return closesFence(run, fence) ? null : fence;
}

// A backtick fence's info string holds no backtick, so a run followed by one is
// a code span.
function isInlineCode(run: RegExpExecArray): boolean {
  return run[1][0] === '`' && run[2].includes('`');
}

// A fence closes only on a run of its own character at least as long, with
// nothing after it, as CommonMark has it.
function closesFence(run: RegExpExecArray, fence: string): boolean {
  const isSameCharacter = run[1][0] === fence[0];
  const isLongEnough = run[1].length >= fence.length;
  return isSameCharacter && isLongEnough && run[2].trim() === '';
}
