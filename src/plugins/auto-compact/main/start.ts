import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import { autoCompactManifest } from '../manifest';
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
// the next send or process start.
export const autoCompactMainPart: MainPart<typeof autoCompactManifest> = {
  manifest: autoCompactManifest,
  start(api: AutoCompactApi) {
    const chat = api.dependency<ChatMainExports>('chat');
    let latest: LatestUsage = new Map();
    api.events.on('chat.agentEvent', ({ hostSessionId, event }) => {
      latest = withAgentEvent(latest, hostSessionId, event);
    });
    const removeGate = chat.addSendGate((input) =>
      sendGateVerdict(
        latest.get(input.hostSessionId) ?? null,
        api.settings().minTokens,
        input.text,
        input.now,
      ),
    );
    const removeThreshold = chat.addIdleCompactThreshold(() => {
      const { minTokens } = api.settings();
      return minTokens > 0 ? minTokens : null;
    });
    return {
      commands: {},
      dispose: () => {
        removeGate();
        removeThreshold();
      },
    };
  },
};
