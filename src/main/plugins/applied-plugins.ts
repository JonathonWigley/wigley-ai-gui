// The applied list: the plugins whose parts do not run, which the served
// config carries as `plugins.disabled`.
export interface AppliedPlugins {
  disabled(): readonly string[];
  // Keeps its own copy of `disabled`; nothing listens.
  set(disabled: readonly string[]): void;
}

// The applied list, `initial` until the first `set`.
export function createAppliedPlugins(
  initial: readonly string[],
): AppliedPlugins {
  let current: readonly string[] = [...initial];
  return {
    disabled: () => current,
    set(disabled) {
      current = [...disabled];
    },
  };
}
