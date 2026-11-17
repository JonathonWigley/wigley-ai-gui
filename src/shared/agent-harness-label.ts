import type {
  AgentHarnessInfo,
  AgentHarnessRegistry,
} from '../contracts/agent';

// Labels of harness ids that reach the app with no adapter registered: a Codex
// terminal session's relay hello names `codex`. A stand-in until the Codex
// adapter lands and registers its own label; drop its entry then.
const UNREGISTERED_LABELS: ReadonlyMap<string, string> = new Map([
  ['codex', 'Codex'],
]);

// The label a harness registered under `id`, else the stand-in label for a
// known unregistered id, else `id` itself. Page code passes `all()` of the
// `core.agentHarnesses` slot; main code passes
// `registeredInfos(services.agentHarnesses)`.
export function harnessLabel(
  infos: ReadonlyMap<string, AgentHarnessInfo>,
  id: string,
): string {
  return infos.get(id)?.label ?? UNREGISTERED_LABELS.get(id) ?? id;
}

// Each listed harness's `info()` by its id, in registration order.
export function registeredInfos(
  registry: Pick<AgentHarnessRegistry, 'list'>,
): ReadonlyMap<string, AgentHarnessInfo> {
  return new Map(
    registry.list().map((harness) => [harness.id, harness.info()]),
  );
}
