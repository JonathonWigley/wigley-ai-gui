// The object a user's `layout.js` module exports as its default, for the
// owner's reader to check part by part. Throws
// `layout <name>: the default export is missing or not an object` for any
// other module.
export function readLayoutModule(
  module: unknown,
  name: string,
): Record<string, unknown> {
  const layout = isRecord(module) ? module.default : undefined;
  if (!isRecord(layout)) {
    throw new Error(
      `layout ${name}: the default export is missing or not an object`,
    );
  }
  return layout;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The layout a user's `layout.js` module exports as its default, read as
// `readLayoutModule` reads it and checked by `requireLayoutParts` against
// `parts`, every part the owner's layout may define.
export function readLayoutParts<L>(
  module: unknown,
  name: string,
  parts: Readonly<Record<keyof L & string, true>>,
): L {
  const layout = readLayoutModule(module, name);
  requireLayoutParts(layout, name, parts);
  return layout as L;
}

// Throws `layout <name>: <prefix><key> is not a layout part` for the first
// key of `record` that `parts` lacks, then
// `layout <name>: <prefix><key> is not a function` for the first part that is
// neither a function nor undefined; an undefined part is left out. A nested
// reader passes its inner object with `prefix` naming it (`entries.`).
export function requireLayoutParts(
  record: Record<string, unknown>,
  name: string,
  parts: Readonly<Record<string, true>>,
  prefix = '',
): void {
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!Object.hasOwn(parts, key)) {
      throw new Error(`layout ${name}: ${prefix}${key} is not a layout part`);
    }
  }
  for (const key of keys) {
    const isPart =
      record[key] === undefined || typeof record[key] === 'function';
    if (!isPart) {
      throw new Error(`layout ${name}: ${prefix}${key} is not a function`);
    }
  }
}
