// Turns `npm run selftest -- …` arguments into the run's filter: which
// plugins' scripts and which groups the self-test runs.

// What `src/main/selftest-config.ts` reads the filter from, as the JSON of a
// `SelfTestFilter`.
export const SELFTEST_FILTER_ENV = 'PROOF_SELFTEST_FILTER';

export interface SelfTestArgs {
  plugins: string[];
  groups: string[];
}

export const SELFTEST_USAGE =
  'npm run selftest -- [--plugin <id>[,<id>…]]… [--group <name>]…';

// The plugins and groups `argv` (the arguments after `npm run selftest --`)
// names: `--plugin` takes an id or a comma list of ids, `--group` one group
// name, `<plugin>: <name>` or bare, and each repeats. Throws on any other
// argument and on a flag with no value, a `--plugin` list of no id included.
export function parseSelfTestArgs(argv: readonly string[]): SelfTestArgs {
  const args: SelfTestArgs = { plugins: [], groups: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag !== '--plugin' && flag !== '--group') {
      throw new Error(`Unknown argument ${flag}; usage: ${SELFTEST_USAGE}`);
    }
    const value = argv[index + 1]?.trim() ?? '';
    const takesNoValue = () =>
      new Error(`${flag} takes a value; usage: ${SELFTEST_USAGE}`);
    if (value === '' || value.startsWith('--')) {
      throw takesNoValue();
    }
    index++;
    if (flag === '--plugin') {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      if (ids.length === 0) {
        throw takesNoValue();
      }
      args.plugins.push(...ids);
    } else {
      args.groups.push(value);
    }
  }
  return args;
}

// The environment that carries the self-test's filter: the variable is
// empty for a run of every script, so a value inherited from the shell never
// narrows it.
export function filterEnvOf(args: SelfTestArgs): Record<string, string> {
  const isFiltered = args.plugins.length > 0 || args.groups.length > 0;
  return { [SELFTEST_FILTER_ENV]: isFiltered ? JSON.stringify(args) : '' };
}
