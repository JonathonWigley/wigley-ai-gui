// The applied list: the plugins whose parts do not run, which the served
// config carries as `plugins.disabled`; and the paused list: the plugins whose
// parts restart now, which the served config keeps without their binds.
export interface AppliedPlugins {
  disabled(): readonly string[];
  // Keeps its own copy of `disabled`; nothing listens.
  set(disabled: readonly string[]): void;
  // Empty until the first `setPaused`.
  paused(): readonly string[];
  // Keeps its own copy of `ids`; nothing listens.
  setPaused(ids: readonly string[]): void;
}

// The applied list, `initial` until the first `set`, and an empty paused list.
export function createAppliedPlugins(
  initial: readonly string[],
): AppliedPlugins {
  let current: readonly string[] = [...initial];
  let paused: readonly string[] = [];
  return {
    disabled: () => current,
    set(disabled) {
      current = [...disabled];
    },
    paused: () => paused,
    setPaused(ids) {
      paused = [...ids];
    },
  };
}
