import { describe, expect, it } from 'vitest';
import { parseIdentityHash, searchListWith } from './mac-signing.mts';

const OTHER_HASH = '1111111111111111111111111111111111111111';
const HASH = '7BCA162CF6C0D1F9F28FEA16A5B13749E2098C59';
const NAME = 'wigley-ai-gui local signing';

describe('parseIdentityHash', () => {
  it.each([
    {
      why: 'an untrusted self-signed identity still counts',
      output: `Policy: Code Signing\n  Matching identities\n  1) ${HASH} "${NAME}" (CSSMERR_TP_NOT_TRUSTED)\n     1 identities found\n`,
      expected: HASH,
    },
    {
      why: 'another identity listed first is skipped',
      output: `  1) ${OTHER_HASH} "Someone Else"\n  2) ${HASH} "${NAME}"\n`,
      expected: HASH,
    },
    {
      why: 'a name that only starts the same is not a match',
      output: `  1) ${OTHER_HASH} "${NAME} old"\n`,
      expected: null,
    },
    {
      why: 'no identities at all',
      output: '     0 valid identities found\n',
      expected: null,
    },
  ])('$why', ({ output, expected }) => {
    expect(parseIdentityHash(output, NAME)).toBe(expected);
  });
});

describe('searchListWith', () => {
  const LOGIN = '/Users/me/Library/Keychains/login.keychain-db';
  const SIGNING = '/Users/me/Library/Keychains/signing.keychain-db';

  it('keeps the listed keychains and adds the new one last', () => {
    expect(searchListWith(`    "${LOGIN}"\n`, SIGNING)).toEqual([
      LOGIN,
      SIGNING,
    ]);
  });

  it('does not list a keychain twice', () => {
    expect(
      searchListWith(`    "${LOGIN}"\n    "${SIGNING}"\n`, SIGNING),
    ).toEqual([LOGIN, SIGNING]);
  });
});
