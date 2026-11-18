import type { AgentHarnessRegistry } from '../../../contracts/agent';
import { type ChatHarnesses, chatHarnessesOf } from './lookups';

// `registry` as chat main reads it, publishing each registered harness's own
// `info()` at each read: no profile is left out, as no test using it holds a
// clashing name.
export function chatHarnessesOfRegistry(
  registry: Pick<AgentHarnessRegistry, 'list' | 'get'>,
): ChatHarnesses {
  return chatHarnessesOf(registry, { get: (id) => registry.get(id)?.info() });
}
