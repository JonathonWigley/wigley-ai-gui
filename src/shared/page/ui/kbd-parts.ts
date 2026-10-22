// One part of a key hint: a key drawn as written, a vim chord the platform
// prints, or the ` / ` between alternatives.
export interface KbdPart {
  kind: 'key' | 'chord' | 'or';
  text: string;
}

const WHOLE_CHORD = /^<[^<>]+>$/;

// The parts of a hint string as the keymap prints it, e.g. `j / k` or
// `Space k s`: tokens split on whitespace, a lone `/` the alternative, a token
// that is wholly one `<…>` group a chord.
export function kbdParts(keys: string): KbdPart[] {
  return keys
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token): KbdPart => {
      if (token === '/') {
        return { kind: 'or', text: token };
      }
      return { kind: WHOLE_CHORD.test(token) ? 'chord' : 'key', text: token };
    });
}
