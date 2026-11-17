import type {
  AgentHarness,
  AgentHarnessInfo,
  AgentHarnessRegistry,
} from '../contracts/agent';

// A registry over a copy of `harnesses` for tests, which may not import the
// real one from `src/main`: `register` appends and its handle removes the
// harness, `refresh` does nothing, and it writes no slot.
export function harnessRegistryOf(
  harnesses: readonly AgentHarness[],
): AgentHarnessRegistry {
  const registered = [...harnesses];
  return {
    register(harness) {
      registered.push(harness);
      return {
        refresh: () => undefined,
        dispose() {
          const at = registered.indexOf(harness);
          if (at !== -1) {
            registered.splice(at, 1);
          }
        },
      };
    },
    list: () => [...registered],
    get: (id) => registered.find((harness) => harness.id === id) ?? null,
  };
}

// An `AgentHarnessInfo` for tests and fixtures; every one is built here, so a
// field added to the info changes only these defaults.
export function harnessInfo(
  overrides?: Partial<AgentHarnessInfo>,
): AgentHarnessInfo {
  return { label: 'Harness', ...overrides };
}
