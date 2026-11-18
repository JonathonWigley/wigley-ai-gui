export type PlaytestSignal =
  | { kind: 'start'; projectPath: string | null }
  | { kind: 'stop'; projectPath: string | null };

type Runner = 'unity' | 'capture';

const UNITY_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--timeout',
  '--port',
  '--pid',
  '--instance',
  '--runtime',
  '--runtime-path',
  '--detail',
  '--query',
  '--tag',
]);

const CAPTURE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--fps',
  '--backend',
]);

const PROJECT_PATH_FLAG = '--project-path';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PYTHON_PROGRAM = /^(?:.*\/)?python(?:3(?:\.\d+)?)?$/;
const CAPTURE_SCRIPT = /^(?:.*\/)?capture\.py$/;
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
// quotes removed, and whether `<<-` strips leading tabs from its lines.
function heredocAt(text: string, start: number): Heredoc {
  const stripsTabs = text[start] === '-';
  let i = stripsTabs ? start + 1 : start;
  while (text[i] === ' ' || text[i] === '\t') {
    i += 1;
  }
  let terminator = '';
  while (i < text.length && !/[\s;&|<>()]/.test(text[i] ?? '')) {
    const char = text[i] ?? '';
    if (char !== "'" && char !== '"' && char !== '\\') {
      terminator += char;
    }
    i += 1;
  }
  return { terminator, stripsTabs };
}

// Skips the bodies of `heredocs`, in order, from the line at `start`, and
// returns the index of the line after the last terminator.
function skipHeredocBodies(
  text: string,
  start: number,
  heredocs: readonly Heredoc[],
): number {
  let i = start;
  for (const { terminator, stripsTabs } of heredocs) {
    while (i < text.length) {
      const newline = text.indexOf('\n', i);
      const end = newline === -1 ? text.length : newline;
      const line = text.slice(i, end);
      i = end + 1;
      if ((stripsTabs ? line.replace(/^\t+/, '') : line) === terminator) {
        break;
      }
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

// The runner a segment's words invoke, and the index of the first word after
// `command` (unity) or after the script word (capture); null for any other.
function runnerOf(
  words: readonly string[],
): { runner: Runner; argsStart: number } | null {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) {
    i += 1;
  }
  const program = words[i];
  if (program === undefined) {
    return null;
  }
  const isUnity = program === 'unity' || program.endsWith('/unity');
  if (isUnity) {
    return words[i + 1] === 'command'
      ? { runner: 'unity', argsStart: i + 2 }
      : null;
  }
  if (!PYTHON_PROGRAM.test(program)) {
    return null;
  }
  let script = i + 1;
  while (script < words.length && (words[script] ?? '').startsWith('-')) {
    script += 1;
  }
  const scriptWord = words[script];
  return scriptWord !== undefined && CAPTURE_SCRIPT.test(scriptWord)
    ? { runner: 'capture', argsStart: script + 1 }
    : null;
}

// The positionals and the last `--project-path` among a runner's arguments,
// with redirections and flags dropped.
function readArgs(
  words: readonly string[],
  valueFlags: ReadonlySet<string>,
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
    } else if (word === PROJECT_PATH_FLAG) {
      const hasValue = next !== undefined && !next.startsWith('-');
      if (hasValue && next !== '') {
        projectPath = next;
      }
      i += hasValue ? 2 : 1;
    } else if (word.startsWith(`${PROJECT_PATH_FLAG}=`)) {
      const value = word.slice(PROJECT_PATH_FLAG.length + 1);
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

function signalOfSegment(words: readonly string[]): PlaytestSignal | null {
  const invocation = runnerOf(words);
  if (invocation === null) {
    return null;
  }
  const isUnity = invocation.runner === 'unity';
  const { positionals, projectPath } = readArgs(
    words.slice(invocation.argsStart),
    isUnity ? UNITY_VALUE_FLAGS : CAPTURE_VALUE_FLAGS,
  );
  const name = positionals[0];
  if (isUnity && name === 'editor_play') {
    return { kind: 'start', projectPath };
  }
  if (isUnity && name === 'editor_stop') {
    return { kind: 'stop', projectPath };
  }
  if (!isUnity && name === 'start') {
    return { kind: 'start', projectPath };
  }
  return null;
}

// Whether a Bash command's text starts a playtest (`unity command editor_play`,
// `capture.py start`) or stops one (`unity command editor_stop`), with the
// `--project-path` it names; the last segment that signals wins. Variables and
// command substitution are read as written, not expanded, and a heredoc's body
// signals nothing.
export function parsePlaytestCommand(command: string): PlaytestSignal | null {
  let signal: PlaytestSignal | null = null;
  for (const words of segmentsOf(command)) {
    signal = signalOfSegment(words) ?? signal;
  }
  return signal;
}
