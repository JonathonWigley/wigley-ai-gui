// Turns `npm run drive -- <command> …` arguments into what the CLI does: start
// or restart a run, print help, or send one command to the running app. Each
// positional form below builds exactly the args its drive command checks.

export type DriveHarness = 'fake' | 'claude';

export type DriveInvocation =
  | {
      kind: 'start';
      packaged: boolean;
      harness: DriveHarness;
      userConfig: boolean;
      run: string | null;
    }
  | { kind: 'restart'; run: string | null }
  | { kind: 'help'; run: string | null }
  | {
      kind: 'send';
      command: string;
      args: Record<string, unknown>;
      run: string | null;
    };

interface Flags {
  run: string | null;
  packaged: boolean;
  harness: string | null;
  userConfig: boolean;
  plugin: string | null;
}

interface PositionalForm {
  usage: string;
  // The command's args from the arguments after its name.
  parse(rest: string[], flags: Flags): Record<string, unknown>;
}

const HARNESSES: readonly DriveHarness[] = ['fake', 'claude'];

const VALUE_FLAGS = ['--run', '--harness', '--plugin'];

// The flags each command accepts beyond `--run`, which every command takes.
const COMMAND_FLAGS: Record<string, string[]> = {
  start: ['--packaged', '--harness', '--user-config'],
  setting: ['--plugin'],
};

const POSITIONAL_FORMS: Record<string, PositionalForm> = {
  key: {
    usage: 'key <tokens…>',
    parse: (rest) => {
      requireCount(rest, 1, Infinity, 'key <tokens…>');
      return { keys: rest.flatMap(keyTokens) };
    },
  },
  type: {
    usage: 'type <text>',
    parse: (rest) => {
      requireCount(rest, 1, Infinity, 'type <text>');
      return { text: rest.join(' ') };
    },
  },
  click: {
    usage: 'click <selector>',
    parse: (rest) => {
      requireCount(rest, 1, 1, 'click <selector>');
      return { selector: rest[0] };
    },
  },
  drag: {
    usage: 'drag <selector> <dx> <dy>',
    parse: (rest) => {
      requireCount(rest, 3, 3, 'drag <selector> <dx> <dy>');
      return {
        selector: rest[0],
        dx: numberArg(rest[1], 'dx'),
        dy: numberArg(rest[2], 'dy'),
      };
    },
  },
  resize: {
    usage: 'resize <width> <height>',
    parse: (rest) => {
      requireCount(rest, 2, 2, 'resize <width> <height>');
      return {
        width: numberArg(rest[0], 'width'),
        height: numberArg(rest[1], 'height'),
      };
    },
  },
  setting: {
    usage: 'setting <name> <json value> [--plugin <id>]',
    parse: (rest, flags) => {
      requireCount(rest, 2, 2, 'setting <name> <json value> [--plugin <id>]');
      const value = jsonArg(rest[1], 'setting value');
      return flags.plugin === null
        ? { name: rest[0], value }
        : { name: rest[0], value, plugin: flags.plugin };
    },
  },
  'wait-log': {
    usage: 'wait-log <line> [{"timeoutMs":n}]',
    parse: (rest) => {
      requireCount(rest, 1, 2, 'wait-log <line> [json]');
      return { line: rest[0], ...optionalJsonObject(rest[1], 'wait-log') };
    },
  },
  log: {
    usage: 'log [since]',
    parse: (rest) => sinceArgs(rest, 'log [since]'),
  },
  console: {
    usage: 'console [since]',
    parse: (rest) => sinceArgs(rest, 'console [since]'),
  },
  screenshot: {
    usage: 'screenshot <name> [selector]',
    parse: (rest) => {
      requireCount(rest, 1, 2, 'screenshot <name> [selector]');
      return rest.length === 1
        ? { name: rest[0] }
        : { name: rest[0], selector: rest[1] };
    },
  },
  query: {
    usage: 'query <selector> [style,style…]',
    parse: (rest) => {
      requireCount(rest, 1, 2, 'query <selector> [style,style…]');
      return rest.length === 1
        ? { selector: rest[0] }
        : { selector: rest[0], styles: commaList(rest[1]) };
    },
  },
  fit: {
    usage: 'fit [width] [selector,selector…]',
    parse: (rest) => {
      requireCount(rest, 0, 2, 'fit [width] [selector,selector…]');
      const startsWithWidth = rest.length === 2 || isNumberText(rest[0]);
      if (!startsWithWidth) {
        return rest.length === 0 ? {} : { scrollsItself: commaList(rest[0]) };
      }
      const width = numberArg(rest[0], 'width');
      return rest.length === 1
        ? { width }
        : { width, scrollsItself: commaList(rest[1]) };
    },
  },
  eval: {
    usage: 'eval <script>',
    parse: (rest) => {
      requireCount(rest, 1, 1, 'eval <script>');
      return { script: rest[0] };
    },
  },
  record: {
    usage: 'record start [name] · record stop',
    parse: (rest) => {
      const isStart = rest[0] === 'start';
      const isStop = rest[0] === 'stop';
      const isFullForm =
        (isStart && rest.length <= 2) || (isStop && rest.length === 1);
      if (!isFullForm) {
        throw new Error('record takes record start [name] or record stop');
      }
      return rest.length === 2
        ? { action: 'start', name: rest[1] }
        : { action: rest[0] };
    },
  },
  do: {
    usage: 'do <name> [json]',
    parse: (rest) => {
      requireCount(rest, 1, 2, 'do <name> [json]');
      return rest.length === 1
        ? { name: rest[0] }
        : { name: rest[0], args: jsonArg(rest[1], 'do args') };
    },
  },
};

// The CLI's own forms, for `help`; the live run's `help` lists the commands.
export const CLI_FORMS = [
  'npm run drive -- <command> [--run <id>]',
  '',
  'start [--packaged] [--harness fake|claude] [--user-config]',
  'restart',
  'help',
  ...Object.values(POSITIONAL_FORMS).map((form) => form.usage),
  '<command> [json]',
  '',
  'Without --run, a command goes to the run .drive/current names.',
].join('\n');

// What `argv` (the arguments after `npm run drive --`) asks the CLI to do.
// Throws naming the problem: an unknown or misplaced flag, a harness other
// than fake or claude, or arguments that fit no form of the command.
export function parseDriveArgs(argv: string[]): DriveInvocation {
  const { flags, positionals } = splitFlags(argv);
  const [command = 'help', ...rest] = positionals;
  requireFlagsOf(command, argv);
  const run = flags.run;
  if (command === 'start') {
    requireCount(rest, 0, 0, 'start');
    return {
      kind: 'start',
      packaged: flags.packaged,
      harness: harnessOf(flags.harness),
      userConfig: flags.userConfig,
      run,
    };
  }
  if (command === 'restart' || command === 'help') {
    requireCount(rest, 0, 0, command);
    return { kind: command, run };
  }
  const form = Object.hasOwn(POSITIONAL_FORMS, command)
    ? POSITIONAL_FORMS[command]
    : null;
  if (form !== null) {
    return { kind: 'send', command, args: form.parse(rest, flags), run };
  }
  requireCount(rest, 0, 1, `${command} [json]`);
  return {
    kind: 'send',
    command,
    args: optionalJsonObject(rest[0], command),
    run,
  };
}

function splitFlags(argv: string[]): { flags: Flags; positionals: string[] } {
  const flags: Flags = {
    run: null,
    packaged: false,
    harness: null,
    userConfig: false,
    plugin: null,
  };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    if (VALUE_FLAGS.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${argument} takes a value`);
      }
      index++;
      setValueFlag(flags, argument, value);
      continue;
    }
    if (argument === '--packaged') {
      flags.packaged = true;
    } else if (argument === '--user-config') {
      flags.userConfig = true;
    } else {
      throw new Error(`Unknown flag ${argument}`);
    }
  }
  return { flags, positionals };
}

function setValueFlag(flags: Flags, flag: string, value: string): void {
  if (flag === '--run') {
    flags.run = value;
  } else if (flag === '--harness') {
    flags.harness = value;
  } else {
    flags.plugin = value;
  }
}

// Throws on a flag `command` does not take; every command takes `--run`.
function requireFlagsOf(command: string, argv: string[]): void {
  const allowed = ['--run', ...(COMMAND_FLAGS[command] ?? [])];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      continue;
    }
    if (!allowed.includes(argument)) {
      throw new Error(`${command} does not take ${argument}`);
    }
    if (VALUE_FLAGS.includes(argument)) {
      index++;
    }
  }
}

function harnessOf(harness: string | null): DriveHarness {
  if (harness === null) {
    return 'fake';
  }
  const known = HARNESSES.find((name) => name === harness);
  if (known === undefined) {
    throw new Error(`--harness is fake or claude, not ${harness}`);
  }
  return known;
}

function requireCount(
  rest: string[],
  min: number,
  max: number,
  usage: string,
): void {
  if (rest.length < min || rest.length > max) {
    throw new Error(`Expected ${usage}, got ${JSON.stringify(rest)}`);
  }
}

// One `key` argument's tokens: split on whitespace, `Space` standing for ' '.
function keyTokens(argument: string): string[] {
  return argument
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => (token === 'Space' ? ' ' : token));
}

function sinceArgs(rest: string[], usage: string): Record<string, unknown> {
  requireCount(rest, 0, 1, usage);
  return rest.length === 0 ? {} : { since: numberArg(rest[0], 'since') };
}

function isNumberText(text: string | undefined): boolean {
  return text !== undefined && text.trim() !== '' && Number.isFinite(+text);
}

function numberArg(text: string, name: string): number {
  if (!isNumberText(text)) {
    throw new Error(`${name} must be a number, not ${text}`);
  }
  return Number(text);
}

function commaList(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function jsonArg(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${name} must be JSON (quote a string as '"text"'), not ${text}`,
    );
  }
}

function optionalJsonObject(
  text: string | undefined,
  name: string,
): Record<string, unknown> {
  if (text === undefined) {
    return {};
  }
  const value = jsonArg(text, `${name} args`);
  const isObject =
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isObject) {
    throw new Error(`${name} args must be a JSON object, not ${text}`);
  }
  return value as Record<string, unknown>;
}
