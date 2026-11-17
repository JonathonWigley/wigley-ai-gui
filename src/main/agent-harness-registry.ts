import type {
  AgentHarness,
  AgentHarnessInfo,
  AgentHarnessRegistration,
  AgentHarnessRegistry,
} from '../contracts/agent';
import type { KeyedSlotWriter } from '../contracts/state';

// The registry behind `services.agentHarnesses`, writing each live harness's
// `info()` to `slot` (`core.agentHarnesses`) under its id. A harness joins
// `list` and `get` before its key is set and leaves them before its key is
// deleted, so a slot listener that reads the registry sees what the slot says.
export function createAgentHarnessRegistry(
  slot: KeyedSlotWriter<AgentHarnessInfo>,
): AgentHarnessRegistry {
  const harnesses: AgentHarness[] = [];

  return {
    register(harness) {
      const { id } = harness;
      if (harnesses.some((registered) => registered.id === id)) {
        throw new Error(`agent harness "${id}" is already registered`);
      }
      harnesses.push(harness);
      slot.set(id, harness.info());
      let isDisposed = false;
      const registration: AgentHarnessRegistration = {
        refresh() {
          if (!isDisposed) {
            slot.set(id, harness.info());
          }
        },
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          harnesses.splice(harnesses.indexOf(harness), 1);
          slot.delete(id);
        },
      };
      return registration;
    },
    list: () => [...harnesses],
    get: (id) => harnesses.find((harness) => harness.id === id) ?? null,
  };
}
