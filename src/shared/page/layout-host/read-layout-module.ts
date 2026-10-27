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
