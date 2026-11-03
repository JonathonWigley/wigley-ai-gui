// Vim's character and word motions with each file chip as one character:
// `h`, `l`, `x`, `X`, `~` and `w`, `W`, `e`, `E`, `b`, `B`, `ge`, `gE` step
// over a chip whole, and a chip is a word of its own. Vim offers no way to
// call its own motions, so both are written again here after vim's; with no
// chip on a line they move as vim's do.
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { CodeMirror, Vim } from '@replit/codemirror-vim';
import { fileChipsOf, type Span } from './chip-decorations';

// Vim's position: a 0-based line and a column on it.
export interface LinePos {
  line: number;
  ch: number;
}

export interface WordMotion {
  repeat: number;
  forward: boolean;
  wordEnd: boolean;
  bigWord: boolean;
}

// Replaces vim's `moveByCharacters` and `moveByWords`, which every editor's
// vim shares; an editor that draws no chips moves as before.
export function defineChipMotions() {
  Vim.defineMotion('moveByCharacters', (cm, head, motionArgs) => {
    const { state } = cm.cm6 as EditorView;
    const chips = fileChipsOf(state);
    const target = chipCharacterTarget(
      state.doc,
      chips,
      head,
      motionArgs.repeat,
      motionArgs.forward === true,
    );
    return new CodeMirror.Pos(target.line, target.ch);
  });
  Vim.defineMotion('moveByWords', (cm, head, motionArgs) => {
    const { state } = cm.cm6 as EditorView;
    const chips = fileChipsOf(state);
    const target = chipWordTarget(state.doc, chips, head, {
      repeat: motionArgs.repeat,
      forward: motionArgs.forward === true,
      wordEnd: motionArgs.wordEnd === true,
      bigWord: motionArgs.bigWord === true,
    });
    return target && new CodeMirror.Pos(target.line, target.ch);
  });
}

// Vim's `l` (`forward`) or `h` `repeat` times from `head`, unclipped as vim
// leaves it: a step from anywhere on a chip goes past it, and a step back
// onto a chip lands on its start.
export function chipCharacterTarget(
  doc: Text,
  chips: readonly Span[],
  head: LinePos,
  repeat: number,
  forward: boolean,
): LinePos {
  const lineChips = chipsOnLine(doc, chips, head.line);
  let ch = head.ch;
  for (let step = 0; step < repeat; step += 1) {
    ch = forward ? stepForward(lineChips, ch) : stepBackward(lineChips, ch);
  }
  return { line: head.line, ch };
}

// Where vim's word motion `motion` lands from `head`, each chip read as one
// character of a class of its own; undefined where vim's finds no word.
export function chipWordTarget(
  doc: Text,
  chips: readonly Span[],
  head: LinePos,
  motion: WordMotion,
): LinePos | undefined {
  const lines = collapsedLines(doc, chips);
  const start = {
    line: head.line,
    ch: toCollapsedColumn(lines.chips(head.line), head.ch),
  };
  const target = moveToWord(lines, start, motion);
  return (
    target && {
      line: target.line,
      ch: fromCollapsedColumn(lines.chips(target.line), target.ch),
    }
  );
}

function chipAt(chips: readonly Span[], ch: number): Span | undefined {
  return chips.find((chip) => chip.from <= ch && ch < chip.to);
}

function stepForward(chips: readonly Span[], ch: number): number {
  return chipAt(chips, ch)?.to ?? ch + 1;
}

function stepBackward(chips: readonly Span[], ch: number): number {
  const before = (chipAt(chips, ch)?.from ?? ch) - 1;
  return chipAt(chips, before)?.from ?? before;
}

// The chips wholly on 0-based `line`, in its columns.
function chipsOnLine(doc: Text, chips: readonly Span[], line: number): Span[] {
  if (line < 0 || line >= doc.lines) {
    return [];
  }
  const { from, to } = doc.line(line + 1);
  return chips
    .filter((chip) => chip.from >= from && chip.to <= to)
    .map((chip) => ({ from: chip.from - from, to: chip.to - from }));
}

// Stands for a chip in a collapsed line; no path holds it.
const CHIP_MARK = '';

// A document's lines, each chip on them collapsed to one CHIP_MARK.
interface CollapsedLines {
  lastLine: number;
  text(line: number): string;
  chips(line: number): readonly Span[];
}

function collapsedLines(doc: Text, chips: readonly Span[]): CollapsedLines {
  return {
    lastLine: doc.lines - 1,
    text: (line) => {
      if (line < 0 || line >= doc.lines) {
        return '';
      }
      const text = doc.line(line + 1).text;
      let collapsed = '';
      let at = 0;
      for (const chip of chipsOnLine(doc, chips, line)) {
        collapsed += text.slice(at, chip.from) + CHIP_MARK;
        at = chip.to;
      }
      return collapsed + text.slice(at);
    },
    chips: (line) => chipsOnLine(doc, chips, line),
  };
}

// Column `ch` of a line holding `chips` in that line collapsed: a column on
// a chip is its mark's.
function toCollapsedColumn(chips: readonly Span[], ch: number): number {
  let removed = 0;
  for (const chip of chips) {
    if (ch < chip.from) {
      break;
    }
    if (ch < chip.to) {
      return chip.from - removed;
    }
    removed += chip.to - chip.from - 1;
  }
  return ch - removed;
}

// Collapsed column `column` back in the line holding `chips`: a chip's mark
// is the chip's start.
function fromCollapsedColumn(chips: readonly Span[], column: number): number {
  let removed = 0;
  for (const chip of chips) {
    if (column <= chip.from - removed) {
      break;
    }
    removed += chip.to - chip.from - 1;
  }
  return column + removed;
}

const WHITESPACE = /\s/;

function isChipMark(ch: string): boolean {
  return ch === CHIP_MARK;
}

function isWordChar(ch: string): boolean {
  return ch !== CHIP_MARK && CodeMirror.isWordChar(ch);
}

function isPunctuation(ch: string): boolean {
  return (
    ch !== '' &&
    ch !== CHIP_MARK &&
    !CodeMirror.isWordChar(ch) &&
    !WHITESPACE.test(ch)
  );
}

function isNonBlank(ch: string): boolean {
  return ch !== '' && !WHITESPACE.test(ch);
}

// Vim's character classes for `w`, a chip one of them, and for `W`, where a
// chip is non-blank like its neighbours.
const WORD_CLASSES = [isWordChar, isPunctuation, isChipMark];
const BIG_WORD_CLASSES = [isNonBlank];

interface Word {
  from: number;
  to: number;
  line: number;
}

// Vim's `findWord` over collapsed lines: the next word from `cur` in a
// direction, one chip mark each word of its own.
function findWord(
  lines: CollapsedLines,
  cur: LinePos,
  forward: boolean,
  bigWord: boolean,
  emptyLineIsWord: boolean,
): Word | null {
  const isLine = (line: number) => line >= 0 && line <= lines.lastLine;
  const dir = forward ? 1 : -1;
  const classes = bigWord ? BIG_WORD_CLASSES : WORD_CLASSES;
  let lineNum = cur.line;
  let pos = cur.ch;
  let line = lines.text(lineNum);
  if (emptyLineIsWord && line === '') {
    lineNum += dir;
    line = lines.text(lineNum);
    if (!isLine(lineNum)) {
      return null;
    }
    pos = forward ? 0 : line.length;
  }
  for (;;) {
    if (emptyLineIsWord && line === '') {
      return { from: 0, to: 0, line: lineNum };
    }
    const stop = dir > 0 ? line.length : -1;
    while (pos !== stop) {
      let foundWord = false;
      for (let i = 0; i < classes.length && !foundWord; i += 1) {
        const inClass = classes[i];
        if (!inClass(line.charAt(pos))) {
          continue;
        }
        const wordStart = pos;
        do {
          pos += dir;
        } while (
          pos !== stop &&
          inClass !== isChipMark &&
          inClass(line.charAt(pos))
        );
        const wordEnd = pos;
        foundWord = true;
        const startedAtWordEnd =
          wordStart === cur.ch &&
          lineNum === cur.line &&
          wordEnd === wordStart + dir;
        if (!startedAtWordEnd) {
          return {
            from: Math.min(wordStart, wordEnd + 1),
            to: Math.max(wordStart, wordEnd),
            line: lineNum,
          };
        }
      }
      if (!foundWord) {
        pos += dir;
      }
    }
    lineNum += dir;
    if (!isLine(lineNum)) {
      return null;
    }
    line = lines.text(lineNum);
    pos = dir > 0 ? 0 : line.length;
  }
}

// Vim's `moveToWord` over collapsed lines.
function moveToWord(
  lines: CollapsedLines,
  cur: LinePos,
  { repeat, forward, wordEnd, bigWord }: WordMotion,
): LinePos | undefined {
  const count = forward !== wordEnd ? repeat + 1 : repeat;
  // For `e`, empty lines are not words, as in vim.
  const emptyLineIsWord = !(forward && wordEnd);
  const words: Word[] = [];
  let at = cur;
  for (let i = 0; i < count; i += 1) {
    const word = findWord(lines, at, forward, bigWord, emptyLineIsWord);
    if (!word) {
      const endCh = lines.text(lines.lastLine).length;
      words.push(
        forward
          ? { line: lines.lastLine, from: endCh, to: endCh }
          : { line: 0, from: 0, to: 0 },
      );
      break;
    }
    words.push(word);
    at = { line: word.line, ch: forward ? word.to - 1 : word.from };
  }
  const shortCircuit = words.length !== count;
  const firstWord = words[0];
  let lastWord = words.pop();
  if (forward && !wordEnd) {
    const startedInsideWord =
      firstWord.from === cur.ch && firstWord.line === cur.line;
    if (!shortCircuit && !startedInsideWord) {
      lastWord = words.pop();
    }
    return lastWord && { line: lastWord.line, ch: lastWord.from };
  }
  if (forward) {
    return lastWord && { line: lastWord.line, ch: lastWord.to - 1 };
  }
  if (wordEnd) {
    const startedInsideWord =
      firstWord.to === cur.ch && firstWord.line === cur.line;
    if (!shortCircuit && !startedInsideWord) {
      lastWord = words.pop();
    }
    return lastWord && { line: lastWord.line, ch: lastWord.to };
  }
  return lastWord && { line: lastWord.line, ch: lastWord.from };
}
