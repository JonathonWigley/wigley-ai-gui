import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { formsMainKey } from '../../forms/contract';
import { sessionsMainKey, sessionsRowsSlot } from '../../sessions/contract';
import { agentCommandsManifest } from '../manifest';
import { addDriveActions } from './drive-actions';
import { AGENT_COMMAND_TOOLS, createAgentCommandTools } from './tools';

type AgentCommandsApi = MainApi<typeof agentCommandsManifest, ChannelShape>;

// Contributes `list_commands`, `run_command` and `read_state` to every agent
// session, subagents included, over the command catalog, the rows of
// `sessions.rows`, chat's names and flags, forms' confirm and every slot; in a
// drive run it adds the drive actions that call them.
export const agentCommandsMainPart: MainPart<typeof agentCommandsManifest> = {
  manifest: agentCommandsManifest,
  start(api: AgentCommandsApi) {
    const sessions = api.dependency(sessionsMainKey);
    const chat = api.dependency(chatMainKey);
    const forms = api.dependency(formsMainKey);
    const rows = api.state.read(sessionsRowsSlot);
    const tools = createAgentCommandTools({
      list: () => api.commands.list(),
      runFor: (id, arg, runSessions) =>
        api.commands.runFor(id, arg, runSessions),
      rowIds: () => [...rows.all().keys()],
      senderName: (sessionId) => chat.senderName(sessionId),
      isHeadless: (sessionId) => chat.isHeadless(sessionId),
      isUnattended: (sessionId) => chat.isUnattended(sessionId),
      confirm: (callerId, request, signal, toolUseId) =>
        forms.confirm(callerId, request, signal, toolUseId),
      readAny: (id) => api.state.readAny(id),
      slotIds: () => api.state.slotIds(),
    });
    sessions.contributeTools(AGENT_COMMAND_TOOLS, (session) =>
      tools(session.id),
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, tools);
    }
    return { commands: {} };
  },
};
