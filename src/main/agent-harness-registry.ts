import type {
  AgentHarness,
  AgentHarnessInfo,
  AgentHarnessRegistration,
  AgentHarnessRegistry,
} from '../contracts/agent';
import type { KeyedSlotWriter } from '../contracts/state';
import { isSameJson } from '../shared/json';

// A harness's slot entry, and each profile it left out with the id of the
// harness that holds that name: its own id for a name it lists twice.
interface ComputedEntry {
  harness: AgentHarness;
  info: AgentHarnessInfo;
  leftOut: { name: string; holderId: string }[];
}

// Each harness's `info()` in `harnesses` order, leaving out each profile whose
// name an earlier harness, or an earlier profile of its own, already holds.
function computeEntries(harnesses: readonly AgentHarness[]): ComputedEntry[] {
  const holders = new Map<string, string>();
  return harnesses.map((harness) => {
    const info = harness.info();
    const leftOut: ComputedEntry['leftOut'] = [];
    const profiles = info.profiles.filter((profile) => {
      const holderId = holders.get(profile.name);
      if (holderId !== undefined) {
        leftOut.push({ name: profile.name, holderId });
        return false;
      }
      holders.set(profile.name, harness.id);
      return true;
    });
    return { harness, info: { ...info, profiles }, leftOut };
  });
}

// The registry behind `services.agentHarnesses`, writing each live harness's
// `info()` to `slot` (`core.agentHarnesses`) under its id, with each profile
// whose name an earlier registered harness holds, or that the harness lists
// twice, left out and logged through `log`. A harness joins `list` and `get` before its key is set and leaves
// them before its key is deleted, so a slot listener that reads the registry
// sees what the slot says.
export function createAgentHarnessRegistry(
  slot: KeyedSlotWriter<AgentHarnessInfo>,
  log: (message: string) => void,
): AgentHarnessRegistry {
  const harnesses: AgentHarness[] = [];

  // Recomputes every entry in registration order and sets each one the slot
  // does not already hold, logging the profiles it leaves out.
  function setChangedEntries() {
    for (const entry of computeEntries(harnesses)) {
      const { id } = entry.harness;
      if (isSameJson(slot.get(id), entry.info)) {
        continue;
      }
      slot.set(id, entry.info);
      for (const { name, holderId } of entry.leftOut) {
        log(
          holderId === id
            ? `agent harness "${id}": profile "${name}" listed twice, the later one left out`
            : `agent harness "${id}": profile "${name}" left out, agent harness "${holderId}" has that name`,
        );
      }
    }
  }

  return {
    register(harness) {
      const { id } = harness;
      if (harnesses.some((registered) => registered.id === id)) {
        throw new Error(`agent harness "${id}" is already registered`);
      }
      harnesses.push(harness);
      setChangedEntries();
      let isDisposed = false;
      const registration: AgentHarnessRegistration = {
        refresh() {
          if (!isDisposed) {
            setChangedEntries();
          }
        },
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          harnesses.splice(harnesses.indexOf(harness), 1);
          slot.delete(id);
          setChangedEntries();
        },
      };
      return registration;
    },
    list: () => [...harnesses],
    get: (id) => harnesses.find((harness) => harness.id === id) ?? null,
  };
}
