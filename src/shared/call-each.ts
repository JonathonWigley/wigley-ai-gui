// Calls `call` on each of `items`, a throw not skipping the rest, and throws
// the first error once every call has run.
export function callEach<T>(
  items: readonly T[],
  call: (item: T) => void,
): void {
  const errors: unknown[] = [];
  for (const item of items) {
    try {
      call(item);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw errors[0];
  }
}
