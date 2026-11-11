// One row of a window lister's JSON array: a string `title` and a number in
// each of the lister's `numberKeys`.
export type WindowRow<K extends string> = Record<K, number> & {
  title: string;
};

// The rows of `stdout`, a window lister's JSON array, that hold a string
// `title` and a number in each of `numberKeys`; a row missing one is dropped.
// Throws naming `command` when `stdout` is not a JSON array.
export function parseWindowRows<K extends string>(
  stdout: string,
  command: string,
  numberKeys: readonly K[],
): WindowRow<K>[] {
  const rows = parseJsonArray(stdout, command);
  return rows.filter((row): row is WindowRow<K> =>
    hasWindowFields(row, numberKeys),
  );
}

function parseJsonArray(stdout: string, command: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${command} printed no JSON array: ${stdout.trim().slice(0, 200)}`,
    );
  }
  return parsed;
}

function hasWindowFields(row: unknown, numberKeys: readonly string[]): boolean {
  if (typeof row !== 'object' || row === null) {
    return false;
  }
  const fields = row as Record<string, unknown>;
  const hasNumbers = numberKeys.every((key) => typeof fields[key] === 'number');
  return hasNumbers && typeof fields.title === 'string';
}
