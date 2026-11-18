import { describe, expect, it } from 'vitest';
import { roomFileName, roomOfFileName } from './room-store';

describe('roomFileName', () => {
  it.each([
    { room: 'shop', fileName: 'shop.jsonl' },
    { room: 'new-games_2', fileName: 'new-games_2.jsonl' },
    { room: 'Shop Revamp', fileName: '%53hop%20%52evamp.jsonl' },
    { room: '../x', fileName: '%2E%2E%2Fx.jsonl' },
    { room: 'é', fileName: '%C3%A9.jsonl' },
  ])(
    'roomFileName_EncodesUnsafeCharacters: $room → $fileName',
    ({ room, fileName }) => {
      expect(roomFileName(room)).toBe(fileName);
      expect(roomOfFileName(fileName)).toBe(room);
    },
  );

  it('roomFileName_EmptyRoom_Throws', () => {
    expect(() => roomFileName('')).toThrow();
  });
});

describe('roomOfFileName', () => {
  it.each([
    { fileName: 'notes.txt', room: null },
    { fileName: '%2.jsonl', room: null },
    { fileName: '%2e.jsonl', room: null },
    { fileName: '%FF.jsonl', room: null },
    { fileName: '.jsonl', room: null },
    { fileName: '%61.jsonl', room: null },
    { fileName: '%2D.jsonl', room: null },
    { fileName: '%41%42.jsonl', room: 'AB' },
  ])(
    'roomOfFileName_NotARoomFile_Null: $fileName → $room',
    ({ fileName, room }) => {
      expect(roomOfFileName(fileName)).toBe(room);
    },
  );
});
