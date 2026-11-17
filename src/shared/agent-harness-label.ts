import type {
  AgentHarnessInfo,
  AgentHarnessRegistry,
} from '../contracts/agent';

// The label a harness registered under `id`, else `id` itself: a harness no
// adapter registered (a Codex terminal session's relay today) shows as its raw
// id. Page code passes `all()` of the `core.agentHarnesses` slot; main code
// passes `registeredInfos(services.agentHarnesses)`.
export function harnessLabel(
  infos: ReadonlyMap<string, AgentHarnessInfo>,
  id: string,
): string {
  return infos.get(id)?.label ?? id;
}

// Each listed harness's `info()` by its id, in registration order.
export function registeredInfos(
  registry: Pick<AgentHarnessRegistry, 'list'>,
): ReadonlyMap<string, AgentHarnessInfo> {
  return new Map(
    registry.list().map((harness) => [harness.id, harness.info()]),
  );
}
