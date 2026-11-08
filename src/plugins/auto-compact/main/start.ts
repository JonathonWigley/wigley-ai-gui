import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import { workflowFlowsSlot } from '../../workflow/contract';
import { autoCompactManifest } from '../manifest';
import {
  type AgentWaits,
  agentWaitReason,
  withCompactStarted,
  withFlow,
  withWaitEvent,
} from './agent-wait';
import { type LatestUsage, sendGateVerdict, withAgentEvent } from './send-gate';

type AutoCompactApi = MainApi<
  typeof autoCompactManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// Folds `chat.agentEvent` into each host session's last main usage, and gives
// chat a send gate over it and the threshold for the harness's own idle
// compaction. Both read `minTokens` at each ask, so a settings change applies at
// the next send or process start. It also compacts a session waiting on its
// subagents through chat's `compact`, asked at each `workflow.flows` change and
// each `chat.turnFinished`: the flow's turn end folds after chat's idle, and an
// idle can come after the flow's last change.
export const autoCompactMainPart: MainPart<typeof autoCompactManifest> = {
  manifest: autoCompactManifest,
  start(api: AutoCompactApi) {
    const chat = api.dependency(chatMainKey);
    const flows = api.state.read(workflowFlowsSlot);
    let latest: LatestUsage = new Map();
    // Chat row id → the host session id its agent events carry now.
    const hostIds = new Map<string, string>();
    let waits: AgentWaits = new Map();

    const compactIfWaiting = (sessionId: string) => {
      const hostId = hostIds.get(sessionId);
      const reason = agentWaitReason({
        flow: flows.get(sessionId),
        usage: hostId === undefined ? null : (latest.get(hostId) ?? null),
        minTokens: api.settings().agentWaitMinTokens,
        phase: waits.get(sessionId),
      });
      if (reason !== null && chat.compact(sessionId, reason)) {
        waits = withCompactStarted(waits, sessionId);
      }
    };

    api.events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => {
      latest = withAgentEvent(latest, hostSessionId, event);
      hostIds.set(sessionId, hostSessionId);
      waits = withWaitEvent(waits, sessionId, event);
    });
    api.events.on('chat.turnFinished', ({ sessionId, how }) => {
      if (how === 'idle') {
        compactIfWaiting(sessionId);
      }
    });
    flows.on((sessionId, flow) => {
      waits = withFlow(waits, sessionId, flow);
      if (flow === undefined) {
        hostIds.delete(sessionId);
        return;
      }
      compactIfWaiting(sessionId);
    });
    chat.addSendGate((input) =>
      sendGateVerdict(
        latest.get(input.hostSessionId) ?? null,
        api.settings().minTokens,
        input.text,
        input.now,
      ),
    );
    chat.addIdleCompactThreshold(() => {
      const { minTokens } = api.settings();
      return minTokens > 0 ? minTokens : null;
    });
    return { commands: {} };
  },
};
