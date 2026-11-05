// The identity the Mac app is signed with. macOS ties a privacy grant to an ad hoc
// app's code hash, so an install drops it; a certificate's identity outlasts a
// rebuild. `npm run create-signing-identity` makes that certificate, and a machine
// without one signs ad hoc.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const AD_HOC_IDENTITY = '-';
export const SIGNING_IDENTITY_NAME = 'wigley-ai-gui local signing';
export const SIGNING_KEYCHAIN = path.join(
  homedir(),
  'Library',
  'Keychains',
  'wigley-ai-gui-signing.keychain-db',
);
// Holds only the local self-signed key; a known password lets a build unlock it with no dialog.
export const SIGNING_KEYCHAIN_PASSWORD = 'wigley-ai-gui-local-signing';

// What `codesign --sign` takes: the certificate's hash, or the ad hoc identity
// when this machine has no certificate.
export function macSigningIdentity(): string {
  if (!existsSync(SIGNING_KEYCHAIN)) {
    return AD_HOC_IDENTITY;
  }
  execFileSync('security', [
    'unlock-keychain',
    '-p',
    SIGNING_KEYCHAIN_PASSWORD,
    SIGNING_KEYCHAIN,
  ]);
  // With no keychain named, this reads the search list, which is all codesign looks in.
  const identities = execFileSync(
    'security',
    ['find-identity', '-p', 'codesigning'],
    { encoding: 'utf8' },
  );
  return (
    parseIdentityHash(identities, SIGNING_IDENTITY_NAME) ?? AD_HOC_IDENTITY
  );
}

// The hash of the identity called `name` in `security find-identity` output.
export function parseIdentityHash(output: string, name: string): string | null {
  for (const line of output.split('\n')) {
    const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*?)"/.exec(line);
    if (match !== null && match[2] === name) {
      return match[1];
    }
  }
  return null;
}

// The `security list-keychains -s` arguments that keep the listed keychains and
// add `keychain`, from `security list-keychains` output.
export function searchListWith(output: string, keychain: string): string[] {
  const listed = output
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter((line) => line !== '');
  return listed.includes(keychain) ? listed : [...listed, keychain];
}
