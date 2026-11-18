import type { PermissionDecision } from '../../../contracts/agent';
import type {
  FakeAgentHarness,
  FakePermissionCall,
} from '../../../shared/fake-agent-harness';

// Fixtures the self-test script and the drive actions share.

// Raises a permission request for `call` on the fake harness's live process for
// the chat row `rowId`, as a tool call in that process would, which draws the
// row's permission card. Resolves to the user's decision once answered, or the
// cancelled one when the process ends first; rejects when the row has no live
// fake process.
export function askFixturePermission(
  fake: Pick<FakeAgentHarness, 'askPermission'>,
  rowId: string,
  call: FakePermissionCall,
): Promise<PermissionDecision> {
  return fake.askPermission(rowId, call);
}
