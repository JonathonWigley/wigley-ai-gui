import type { Disposable } from '../../../contracts/disposable';
import { createMemoryFiles } from '../../../shared/memory-files';
import { createMemoryRoomStore } from './memory-room-store';
import {
  createRoomService,
  type RoomService,
  type RoomServiceDeps,
} from './room-service';

export interface DemoRoomsDeps extends Omit<RoomServiceDeps, 'store' | 'files'> {
  // Called with the room of each message a held room takes.
  rewriteRoom(roomName: string): void;
  // Called once a hold ends.
  released(roomName: string): void;
}

export interface DemoRooms {
  // A room service over memory alone, one per held name: a second hold of a held name returns the same object, and
  // one dispose of it releases the hold.
  hold(roomName: string): RoomService & Disposable;
  // The held service of `roomName`, else null.
  serviceFor(roomName: string): RoomService | null;
}

// The demo step's rooms, kept in memory: no room file, cursor or claim of theirs reaches plugin data.
export function createDemoRooms(deps: DemoRoomsDeps): DemoRooms {
  const { rewriteRoom, released, ...serviceDeps } = deps;
  const held = new Map<string, RoomService & Disposable>();
  return {
    hold(roomName) {
      const existing = held.get(roomName);
      if (existing !== undefined) {
        return existing;
      }
      const service = createRoomService({
        ...serviceDeps,
        store: createMemoryRoomStore(),
        files: createMemoryFiles(),
      });
      const subscription = service.onMessage((message) =>
        rewriteRoom(message.room),
      );
      const holding: RoomService & Disposable = {
        ...service,
        dispose() {
          if (held.get(roomName) !== holding) {
            return;
          }
          held.delete(roomName);
          subscription.dispose();
          released(roomName);
        },
      };
      held.set(roomName, holding);
      return holding;
    },
    serviceFor: (roomName) => held.get(roomName) ?? null,
  };
}
