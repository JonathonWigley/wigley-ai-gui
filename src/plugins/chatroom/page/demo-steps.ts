import { MODES_SHOW } from '../../../contracts/commands';
import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices, PluginCommands } from '../../../contracts/plugin';

// `holdPlace` stops `chatroom.place` writes until its dispose.
export interface ChatroomDemoPageDeps {
  commands: Pick<PluginCommands, 'run'>;
  holdPlace(): Disposable;
}

// The Chatroom step: Chatroom mode on the demo room main holds. It holds the
// place so the user's saved one outlasts the demo room.
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
    enter: async () => chatroomStage(deps),
  });
}

function chatroomStage(deps: ChatroomDemoPageDeps): DemoStage {
  const { commands } = deps;
  const placeHold = deps.holdPlace();
  return {
    beats: [
      { name: 'room', show: () => commands.run(MODES_SHOW, 'chatroom.main') },
    ],
    dispose: () => placeHold.dispose(),
  };
}
