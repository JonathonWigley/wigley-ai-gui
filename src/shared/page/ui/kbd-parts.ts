// One part of a key hint: a key drawn as written, a vim chord the platform
// prints, or the ` / ` between alternatives.
export interface KbdPart {
  kind: 'key' | 'chord' | 'or';
  text: string;
}

const WHOLE_CHORD = /^<[^<>]+>$/;

// The parts of a hint string as the keymap prints it, e.g. `j / k` or
// `Space k s`: tokens split on whitespace, a lone `/` between two other tokens
// the alternative, a token that is wholly one `<…>` group a chord. A `/` that
// starts or ends the hint is the slash key.
export function kbdParts(keys: string): KbdPart[] {
  const tokens = keys.split(/\s+/).filter((token) => token !== '');
  return tokens.map((token, index): KbdPart => {
    const isBetweenKeys = index > 0 && index < tokens.length - 1;
    if (token === '/' && isBetweenKeys) {
      return { kind: 'or', text: token };
    }
    return { kind: WHOLE_CHORD.test(token) ? 'chord' : 'key', text: token };
  });
}
