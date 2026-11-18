import { beforeEach, describe } from 'vitest';
import type { RoomStore } from '../contract';
import { createMemoryRoomStore } from './memory-room-store';
import { describeRoomStoreContract } from './room-store.test-support';

let store: RoomStore;

beforeEach(() => {
  store = createMemoryRoomStore();
});

describe('createMemoryRoomStore', () => {
  describeRoomStoreContract(() => store);
});
