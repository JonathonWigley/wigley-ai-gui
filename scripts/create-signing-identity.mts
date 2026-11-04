// `npm run create-signing-identity`: makes the self-signed certificate
// `scripts/mac-signing.mts` signs the Mac app with, in a keychain of its own, so
// a build signs with no keychain dialog. Run once per Mac.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AD_HOC_IDENTITY,
  macSigningIdentity,
  SIGNING_IDENTITY_NAME,
  SIGNING_KEYCHAIN,
  SIGNING_KEYCHAIN_PASSWORD,
  searchListWith,
} from './mac-signing.mts';

const CERTIFICATE_DAYS = '7300';
// macOS's own openssl: its PKCS#12 output is what `security import` reads.
const OPENSSL = '/usr/bin/openssl';
const P12_PASSWORD = 'wigley-ai-gui-import';

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Writes the identity's PKCS#12 file into `folder` and returns its path.
function writeIdentityFile(folder: string): string {
  const key = path.join(folder, 'key.pem');
  const certificate = path.join(folder, 'certificate.pem');
  const identity = path.join(folder, 'identity.p12');
  run(OPENSSL, [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    certificate,
    '-days',
    CERTIFICATE_DAYS,
    '-subj',
    `/CN=${SIGNING_IDENTITY_NAME}`,
    '-addext',
    'keyUsage=critical,digitalSignature',
    '-addext',
    'extendedKeyUsage=critical,codeSigning',
    '-addext',
    'basicConstraints=critical,CA:false',
  ]);
  run(OPENSSL, [
    'pkcs12',
    '-export',
    '-inkey',
    key,
    '-in',
    certificate,
    '-out',
    identity,
    '-passout',
    `pass:${P12_PASSWORD}`,
    '-name',
    SIGNING_IDENTITY_NAME,
  ]);
  return identity;
}

function createKeychainHolding(identityFile: string): void {
  run('security', [
    'create-keychain',
    '-p',
    SIGNING_KEYCHAIN_PASSWORD,
    SIGNING_KEYCHAIN,
  ]);
  // With no options: never locks on a timer or on sleep.
  run('security', ['set-keychain-settings', SIGNING_KEYCHAIN]);
  run('security', [
    'unlock-keychain',
    '-p',
    SIGNING_KEYCHAIN_PASSWORD,
    SIGNING_KEYCHAIN,
  ]);
  run('security', [
    'import',
    identityFile,
    '-k',
    SIGNING_KEYCHAIN,
    '-P',
    P12_PASSWORD,
    '-T',
    '/usr/bin/codesign',
  ]);
  run('security', [
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:,codesign:',
    '-s',
    '-k',
    SIGNING_KEYCHAIN_PASSWORD,
    SIGNING_KEYCHAIN,
  ]);
}

function addKeychainToSearchList(): void {
  const listed = run('security', ['list-keychains', '-d', 'user']);
  run('security', [
    'list-keychains',
    '-d',
    'user',
    '-s',
    ...searchListWith(listed, SIGNING_KEYCHAIN),
  ]);
}

function main(): void {
  if (existsSync(SIGNING_KEYCHAIN)) {
    addKeychainToSearchList();
    const found = macSigningIdentity();
    if (found === AD_HOC_IDENTITY) {
      throw new Error(
        `${SIGNING_KEYCHAIN} holds no "${SIGNING_IDENTITY_NAME}" identity; delete it and run this again.`,
      );
    }
    console.log(`Already set up: ${found}`);
    return;
  }
  const folder = mkdtempSync(path.join(tmpdir(), 'wigley-ai-gui-signing-'));
  try {
    createKeychainHolding(writeIdentityFile(folder));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  addKeychainToSearchList();
  console.log(`Created "${SIGNING_IDENTITY_NAME}": ${macSigningIdentity()}`);
  console.log(
    'Install the app, then allow its folder access once more; later installs keep it.',
  );
}

main();
