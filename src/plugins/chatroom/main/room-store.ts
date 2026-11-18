// The plugin data folder that holds one file per room.
export const ROOMS_FOLDER = 'rooms';

const ROOM_FILE_EXTENSION = '.jsonl';
const KEPT_CHARACTER = /^[a-z0-9_-]$/;
const ENCODED_BYTE = /^[0-9A-F]{2}$/;

function percentEncoded(character: string): string {
  return [...new TextEncoder().encode(character)]
    .map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

// The room's file name: `a`–`z`, `0`–`9`, `_` and `-` kept, every other
// character written as `%XX` per UTF-8 byte, then `.jsonl`. Throws for `''`.
export function roomFileName(room: string): string {
  if (room === '') {
    throw new Error('a room name is empty');
  }
  let name = '';
  for (const character of room) {
    name += KEPT_CHARACTER.test(character)
      ? character
      : percentEncoded(character);
  }
  return name + ROOM_FILE_EXTENSION;
}

// The UTF-8 bytes a file name spells, or null when it holds a character
// `roomFileName` never writes or a `%` without two uppercase hex digits.
function spelledBytes(encoded: string): Uint8Array | null {
  const bytes: number[] = [];
  let index = 0;
  while (index < encoded.length) {
    const character = encoded[index];
    if (character === '%') {
      const hex = encoded.slice(index + 1, index + 3);
      if (!ENCODED_BYTE.test(hex)) {
        return null;
      }
      bytes.push(parseInt(hex, 16));
      index += 3;
    } else if (KEPT_CHARACTER.test(character)) {
      bytes.push(character.charCodeAt(0));
      index += 1;
    } else {
      return null;
    }
  }
  return new Uint8Array(bytes);
}

// `ignoreBOM` keeps a leading U+FEFF in the text rather than dropping it.
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodedText(bytes: Uint8Array): string | null {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    return null;
  }
}

// The room whose file `fileName` is, or null when `roomFileName` of no room
// gives exactly that name.
export function roomOfFileName(fileName: string): string | null {
  if (!fileName.endsWith(ROOM_FILE_EXTENSION)) {
    return null;
  }
  const bytes = spelledBytes(fileName.slice(0, -ROOM_FILE_EXTENSION.length));
  const room = bytes === null ? null : decodedText(bytes);
  if (room === null || room === '') {
    return null;
  }
  return roomFileName(room) === fileName ? room : null;
}
