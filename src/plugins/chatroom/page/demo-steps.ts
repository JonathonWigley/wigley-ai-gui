import { type CommandKey, MODES_SHOW } from '../../../contracts/commands';
import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';
import { sessionsSelectRowCommand } from '../../sessions/contract';

const openRowRoomCommand: CommandKey<string, 'chatroom.openRowRoom'> = {
  id: 'chatroom.openRowRoom',
};

export interface ChatroomDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
}

// The Chatroom step: the lead's row with the peer's question to the user as
// its badge, Chatroom mode on the demo room main holds, then the lead's room
// opened at the question's thread, which marks it read.
export function registerDemoSteps(
  services: PageServices,
  deps: ChatroomDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'chatroom.room',
    section: 'modes',
    order: 60,
    title: 'Chatroom',
    caption:
      'Chatroom: the sessions of one project post, ask and claim work in a shared room.',
    files: [
      'src/plugins/chatroom/page/chatroom-view.ts',
      'src/plugins/chatroom/page/start.ts',
      'src/plugins/chatroom/main/start.ts',
      'src/plugins/chatroom/main/room-service.ts',
    ],
    enter: async (context) => chatroomStage(deps, context),
  });
}

function chatroomStage(
  deps: ChatroomDemoPageDeps,
  context: DemoPageContext,
): DemoStage {
  const { commands } = deps;
  const { lead } = context.sessions;
  return {
    beats: [
      {
        name: 'row badge',
        show: () => commands.run(sessionsSelectRowCommand, lead),
      },
      { name: 'room', show: () => commands.run(MODES_SHOW, 'chatroom.main') },
      {
        name: 'thread',
        show: () => commands.run(openRowRoomCommand, lead),
      },
    ],
    dispose: () => undefined,
  };
}
