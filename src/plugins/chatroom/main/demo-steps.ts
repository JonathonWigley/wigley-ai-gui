import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { RoomService } from './room-service';
import {
  type ChatroomFixtureDeps,
  seedChatroomFixture,
} from './selftest-fixture';

// `holdRoom` holds the demo step's memory room of a name until its dispose.
export interface ChatroomDemoMainDeps {
  fixtureDeps: Omit<ChatroomFixtureDeps, 'launch' | 'roomFor'>;
  holdRoom(roomName: string): RoomService & Disposable;
}

// The Chatroom step's main half: the self-test's fixture seeded by two demo
// sessions in the scratch folder, posting into a memory room held for the
// stage's length.
export function registerDemoSteps(
  services: MainServices,
  deps: ChatroomDemoMainDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'chatroom.room',
      async enter(context) {
        const held: { room: Disposable | null } = { room: null };
        try {
          const fixture = await seedChatroomFixture(
            {
              ...deps.fixtureDeps,
              launch: (title) => context.launchSession(title),
              roomFor: (roomName) => {
                const room = deps.holdRoom(roomName);
                held.room = room;
                return room;
              },
            },
            context.scratchDir,
          );
          const [lead, peer] = fixture.rowIds;
          return {
            sessions: { lead, peer },
            dispose: () => held.room?.dispose(),
          };
        } catch (error) {
          held.room?.dispose();
          throw error;
        }
      },
    }),
  );
  return registrations;
}
