import type {
  CommandPattern,
  LiveViewContribution,
} from '../../../contracts/contributions';
import type { Paths } from '../../../contracts/paths';
import type { FeatureReader, Strategy } from '../../contributions/contract';
import type { PlaytestPatterns } from '../playtest-command';
import type { ProbeScript } from './game-view-probe';

type PatternList = 'open' | 'close';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROBE_REASON = 'probe: not { file, entry, runner: "unityScript" }';

// The `liveView` section's reader: an `open` and a `close` list of command
// patterns, each pattern's `valueFlags` filled with `[]`, and an optional
// probe whose `file` is relative to the plugin root.
export const liveViewReader: FeatureReader<LiveViewContribution> = {
  label: 'Live view',
  read(section) {
    const record = recordOf(section);
    if (record === null) {
      return { ok: false, reasons: ['"liveView" is not an object'] };
    }
    const reasons: string[] = [];
    const open = patternsOf(record.open, 'open', reasons);
    const close = patternsOf(record.close, 'close', reasons);
    const probe =
      record.probe === undefined ? undefined : probeOf(record.probe);
    if (probe === null) {
      reasons.push(PROBE_REASON);
    }
    if (reasons.length > 0) {
      return { ok: false, reasons };
    }
    const value: LiveViewContribution = { open, close };
    if (probe !== undefined && probe !== null) {
      value.probe = probe;
    }
    return { ok: true, value };
  },
};

// Every strategy's `open` and `close` patterns, concatenated in source order.
export function playtestPatternsOf(
  strategies: readonly Strategy<LiveViewContribution>[],
): PlaytestPatterns {
  return {
    open: strategies.flatMap(({ value }) => value.open),
    close: strategies.flatMap(({ value }) => value.close),
  };
}

// The probe of the first strategy in source order that has one, its file
// resolved against the strategy's plugin root; null when none has one.
export function probeScriptOf(
  strategies: readonly Strategy<LiveViewContribution>[],
  paths: Pick<Paths, 'join'>,
): ProbeScript | null {
  const strategy = strategies.find(({ value }) => value.probe !== undefined);
  const probe = strategy?.value.probe;
  if (strategy === undefined || probe === undefined) {
    return null;
  }
  return {
    file: paths.join(strategy.source.root, probe.file),
    entry: probe.entry,
    pluginName: strategy.source.pluginName,
  };
}

function patternsOf(
  value: unknown,
  list: PatternList,
  reasons: string[],
): CommandPattern[] {
  const items = Array.isArray(value) ? value : [];
  const records = items.map(recordOf);
  const isPatternList =
    records.length > 0 && records.every((record) => record !== null);
  if (!isPatternList) {
    reasons.push(`${list}: not a list of command patterns`);
    return [];
  }
  return records.map((record, index) =>
    patternOf(record ?? {}, `${list}[${index}]`, reasons),
  );
}

function patternOf(
  record: Record<string, unknown>,
  at: string,
  reasons: string[],
): CommandPattern {
  const { program, words, valueFlags, projectPathFlag, projectPathVariable } =
    record;
  const isProgramName =
    typeof program === 'string' && program !== '' && !program.includes('/');
  if (!isProgramName) {
    reasons.push(`${at}.program: not a program name`);
  }
  const isWordList =
    Array.isArray(words) &&
    words.length > 0 &&
    words.every((word) => typeof word === 'string' && word !== '');
  if (!isWordList) {
    reasons.push(`${at}.words: not a list of words`);
  }
  const isFlagList =
    valueFlags === undefined ||
    (Array.isArray(valueFlags) && valueFlags.every(isFlag));
  if (!isFlagList) {
    reasons.push(`${at}.valueFlags: not a list of flags`);
  }
  if (projectPathFlag !== undefined && !isFlag(projectPathFlag)) {
    reasons.push(`${at}.projectPathFlag: not a flag`);
  }
  const isVariableName =
    typeof projectPathVariable === 'string' &&
    VARIABLE_NAME.test(projectPathVariable);
  if (projectPathVariable !== undefined && !isVariableName) {
    reasons.push(`${at}.projectPathVariable: not a variable name`);
  }
  const pattern: CommandPattern = {
    program: String(program),
    words: isWordList ? (words as string[]) : [],
    valueFlags: isFlagList ? ((valueFlags as string[] | undefined) ?? []) : [],
  };
  if (typeof projectPathFlag === 'string') {
    pattern.projectPathFlag = projectPathFlag;
  }
  if (typeof projectPathVariable === 'string') {
    pattern.projectPathVariable = projectPathVariable;
  }
  return pattern;
}

// The probe, or null when it is not `{ file, entry, runner: 'unityScript' }`
// with `file` a relative path holding no `..` part.
function probeOf(value: unknown): LiveViewContribution['probe'] | null {
  const record = recordOf(value);
  if (record === null) {
    return null;
  }
  const { file, entry, runner } = record;
  const isRelativeFile =
    typeof file === 'string' &&
    file !== '' &&
    !file.startsWith('/') &&
    !file.split(/[\\/]/).includes('..');
  const isEntry = typeof entry === 'string' && entry !== '';
  if (!isRelativeFile || !isEntry || runner !== 'unityScript') {
    return null;
  }
  return { file, entry, runner };
}

function isFlag(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('-');
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
