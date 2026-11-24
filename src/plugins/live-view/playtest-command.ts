import type { CommandPattern } from '../../contracts/contributions';

export type PlaytestSignal =
  | { kind: 'start'; projectPath: string | null }
  | { kind: 'stop'; projectPath: string | null };

// The command patterns whose segments open a session's Live view (`open`) and
// close it (`close`), each list in match order.
export interface PlaytestPatterns {
  open: readonly CommandPattern[];
  close: readonly CommandPattern[];
}

type Variables = ReadonlyMap<string, string>;

const VARIABLE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PYTHON_PROGRAM = /^(?:.*\/)?python(?:3(?:\.\d+)?)?$/;
const SCRIPT_PROGRAM = /\.py$/;
const JOINED_REDIRECTION = /^(?:[0-9]*(?:>>?|<)&?.+|&>>?.+)$/;
const BARE_REDIRECTION = /^(?:[0-9]*(?:>>?|<)|&>>?)$/;

type Heredoc = { terminator: string; stripsTabs: boolean };

// The command's segments, each as its words with quotes and escapes removed;
// heredoc bodies are left out. Never throws: an unclosed quote runs to the end
// of the text.
function segmentsOf(text: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let wordStarted = false;
  let heredocs: Heredoc[] = [];

  const endWord = (): void => {
    if (wordStarted) {
      words.push(word);
    }
    word = '';
    wordStarted = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) {
      segments.push(words);
    }
    words = [];
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '\\') {
      if (next === '\n') {
        i += 2;
        continue;
      }
      word += next ?? '\\';
      wordStarted = true;
      i += 2;
    } else if (char === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close === -1 ? text.length : close;
      word += text.slice(i + 1, end);
      wordStarted = true;
      i = end + 1;
    } else if (char === '"') {
      i = readDoubleQuoted(text, i + 1, (part) => {
        word += part;
      });
      wordStarted = true;
    } else if (char === ' ' || char === '\t') {
      endWord();
      i += 1;
    } else if (char === '\n') {
      endSegment();
      i = skipHeredocBodies(text, i + 1, heredocs);
      heredocs = [];
    } else if (char === ';') {
      endSegment();
      i += 1;
    } else if (
      (char === '&' && next === '&') ||
      (char === '|' && next === '|')
    ) {
      endSegment();
      i += 2;
    } else if (char === '|' || isBackgroundAmpersand(text, i)) {
      endSegment();
      i += 1;
    } else if (char === '<' && next === '<') {
      const isHereString = text[i + 2] === '<';
      if (!isHereString) {
        heredocs.push(heredocAt(text, i + 2));
      }
      word += isHereString ? '<<<' : '<<';
      wordStarted = true;
      i += isHereString ? 3 : 2;
    } else {
      word += char;
      wordStarted = true;
      i += 1;
    }
  }
  endSegment();
  return segments;
}

// Whether the `&` at `index` runs the command before it in the background,
// rather than being part of `&&`, `&>`, `>&` or `<&`.
function isBackgroundAmpersand(text: string, index: number): boolean {
  const before = text[index - 1];
  const after = text[index + 1];
  const joinsRedirection = after === '>' || before === '>' || before === '<';
  return text[index] === '&' && after !== '&' && !joinsRedirection;
}

// The heredoc whose `<<` ends just before `start`: its terminator word with
// quotes and escapes removed, a quoted run read through its closing quote
// (`<<'END X'` reads `END X`), and whether `<<-` strips leading tabs from its
// lines.
function heredocAt(text: string, start: number): Heredoc {
  const stripsTabs = text[start] === '-';
  let i = stripsTabs ? start + 1 : start;
  while (text[i] === ' ' || text[i] === '\t') {
    i += 1;
  }
  let terminator = '';
  while (i < text.length && !/[\s;&|<>()]/.test(text[i] ?? '')) {
    const char = text[i] ?? '';
    if (char === "'" || char === '"') {
      const close = text.indexOf(char, i + 1);
      const end = close === -1 ? text.length : close;
      terminator += text.slice(i + 1, end);
      i = end + 1;
    } else if (char === '\\') {
      terminator += text[i + 1] ?? '';
      i += 2;
    } else {
      terminator += char;
      i += 1;
    }
  }
  return { terminator, stripsTabs };
}

// Skips the bodies of `heredocs`, in order, from the line at `start`, and
// returns the index of the line after the last terminator. When a terminator
// never appears alone on a later line, it returns `start` and skips nothing:
// a `<<` that opened no heredoc (`$((x<<2))`, a comment) hides no command.
function skipHeredocBodies(
  text: string,
  start: number,
  heredocs: readonly Heredoc[],
): number {
  let i = start;
  for (const { terminator, stripsTabs } of heredocs) {
    let terminatorFound = false;
    while (!terminatorFound && i < text.length) {
      const newline = text.indexOf('\n', i);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(i, end);
      i = end + 1;
      terminatorFound =
        (stripsTabs ? line.replace(/^\t+/, '') : line) === terminator;
    }
    if (!terminatorFound) {
      return start;
    }
  }
  return Math.min(i, text.length);
}

// Reads a double-quoted run starting after its opening quote, passing its
// text to `append`, and returns the index after the closing quote.
function readDoubleQuoted(
  text: string,
  start: number,
  append: (part: string) => void,
): number {
  let i = start;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      return i + 1;
    }
    if (char === '\\' && (next === '"' || next === '\\')) {
      append(next);
      i += 2;
      continue;
    }
    append(char ?? '');
    i += 1;
  }
  return i;
}

// The index of a segment's program word (the words before it are
// `NAME=value` assignments) and of the first word after it, when the segment
// runs `program`: a program word whose base name is `program`, or for a `.py`
// program, Python running a script whose base name is `program`, the script
// word read past Python's own flags; null otherwise. The program and script
// words expand from `variables`.
function invocationOf(
  words: readonly string[],
  variables: Variables,
  program: string,
): { programAt: number; argsStart: number } | null {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) {
    i += 1;
  }
  const programWord = expand(words[i] ?? '', variables);
  if (programWord === null) {
    return null;
  }
  if (!SCRIPT_PROGRAM.test(program)) {
    return baseNameOf(programWord) === program
      ? { programAt: i, argsStart: i + 1 }
      : null;
  }
  if (!PYTHON_PROGRAM.test(programWord)) {
    return null;
  }
  let script = i + 1;
  while (script < words.length && (words[script] ?? '').startsWith('-')) {
    script += 1;
  }
  const scriptWord = expand(words[script] ?? '', variables);
  return scriptWord !== null && baseNameOf(scriptWord) === program
    ? { programAt: i, argsStart: script + 1 }
    : null;
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// The positionals and the last `projectPathFlag` value among a program's
// arguments, with redirections and flags dropped; null `projectPathFlag`
// reads no path.
function readArgs(
  words: readonly string[],
  valueFlags: ReadonlySet<string>,
  projectPathFlag: string | null,
): { positionals: string[]; projectPath: string | null } {
  const positionals: string[] = [];
  let projectPath: string | null = null;
  let i = 0;
  while (i < words.length) {
    const word = words[i] ?? '';
    const next = words[i + 1];
    if (JOINED_REDIRECTION.test(word)) {
      i += 1;
    } else if (BARE_REDIRECTION.test(word)) {
      i += 2;
    } else if (projectPathFlag !== null && word === projectPathFlag) {
      const hasValue = next !== undefined && !next.startsWith('-');
      if (hasValue && next !== '') {
        projectPath = next;
      }
      i += hasValue ? 2 : 1;
    } else if (
      projectPathFlag !== null &&
      word.startsWith(`${projectPathFlag}=`)
    ) {
      const value = word.slice(projectPathFlag.length + 1);
      if (value !== '') {
        projectPath = value;
      }
      i += 1;
    } else if (valueFlags.has(word)) {
      i += 2;
    } else if (word.startsWith('-')) {
      i += 1;
    } else {
      positionals.push(word);
      i += 1;
    }
  }
  return { positionals, projectPath };
}

// `text` with each `$NAME` and `${NAME}` replaced by its value in
// `variables`; null when it names a variable with no value or holds any other
// `$` form (`$(…)`, `$1`). A `$` the command single-quoted reads the same,
// since the words carry no quotes.
function expand(text: string, variables: Variables): string | null {
  let unknown = false;
  const expanded = text.replace(
    VARIABLE,
    (_match: string, braced?: string, bare?: string) => {
      const value = variables.get(braced ?? bare ?? '');
      if (value === undefined) {
        unknown = true;
        return '';
      }
      return value;
    },
  );
  return unknown || expanded.includes('$') ? null : expanded;
}

// Notes in `variables` what a segment sets for the segments after it: a
// segment of only `NAME=value` words, after an optional `export`, sets each
// name in order, and `cd <dir>` sets `PWD`. A value that does not expand
// drops its name, as does a bare `cd`.
function noteVariables(
  words: readonly string[],
  variables: Map<string, string>,
): void {
  if (words[0] === 'cd') {
    const dir = words[1] === undefined ? null : expand(words[1], variables);
    if (dir === null) {
      variables.delete('PWD');
    } else {
      variables.set('PWD', dir);
    }
    return;
  }
  const assignments = words[0] === 'export' ? words.slice(1) : words;
  if (!assignments.every((word) => ASSIGNMENT.test(word))) {
    return;
  }
  for (const word of assignments) {
    const equals = word.indexOf('=');
    const name = word.slice(0, equals);
    const value = expand(word.slice(equals + 1), variables);
    if (value === null) {
      variables.delete(name);
    } else {
      variables.set(name, value);
    }
  }
}

// The project folder a segment names when it runs `pattern` (its program,
// then its positionals starting with the pattern's words), or null when it
// does not run it.
function matchOf(
  words: readonly string[],
  variables: Variables,
  pattern: CommandPattern,
): { projectPath: string | null } | null {
  const invocation = invocationOf(words, variables, pattern.program);
  if (invocation === null) {
    return null;
  }
  const { programAt, argsStart } = invocation;
  const { positionals, projectPath } = readArgs(
    words.slice(argsStart),
    new Set(pattern.valueFlags ?? []),
    pattern.projectPathFlag ?? null,
  );
  const startsWithWords = pattern.words.every(
    (word, index) => positionals[index] === word,
  );
  if (!startsWithWords) {
    return null;
  }
  if (projectPath !== null) {
    return { projectPath: expand(projectPath, variables) };
  }
  const variable = pattern.projectPathVariable;
  if (variable === undefined) {
    return { projectPath: null };
  }
  // A CLI that reads a project variable falls back to it, set by an
  // assignment before the program or earlier on the line, then to the project
  // holding the working folder, read here as the folder the line `cd`s into:
  // one that holds no editor opens nothing.
  const environment = new Map(variables);
  noteVariables(words.slice(0, programAt), environment);
  return {
    projectPath: environment.get(variable) ?? environment.get('PWD') ?? null,
  };
}

// The first pattern a segment runs, `open` before `close`, each in order.
function signalOfSegment(
  words: readonly string[],
  variables: Variables,
  patterns: PlaytestPatterns,
): PlaytestSignal | null {
  const lists = [
    ['start', patterns.open],
    ['stop', patterns.close],
  ] as const;
  for (const [kind, list] of lists) {
    for (const pattern of list) {
      const match = matchOf(words, variables, pattern);
      if (match !== null) {
        return { kind, projectPath: match.projectPath };
      }
    }
  }
  return null;
}

// Whether a Bash command's text starts a playtest (a segment that runs a
// pattern in `patterns.open`) or stops one (a pattern in `patterns.close`),
// with the project folder it names. A segment runs a pattern when its program
// word, or for a `.py` program the script Python runs, has the pattern's
// program as its base name, and its positionals start with the pattern's
// words; within a segment the first pattern wins, open before close, and the
// last segment that signals wins. The folder is the pattern's
// `projectPathFlag` value, else for a pattern with a `projectPathVariable`
// that variable as the line sets it, else the folder the line `cd`s into.
// `$NAME` and `${NAME}` expand from plain assignments and `cd`s in earlier
// segments; a path naming any other variable or a command substitution reads
// as no path. A heredoc's body signals nothing.
export function parsePlaytestCommand(
  command: string,
  patterns: PlaytestPatterns,
): PlaytestSignal | null {
  const variables = new Map<string, string>();
  let signal: PlaytestSignal | null = null;
  for (const words of segmentsOf(command)) {
    signal = signalOfSegment(words, variables, patterns) ?? signal;
    noteVariables(words, variables);
  }
  return signal;
}
