import type { AccountStatus } from '../../contracts/agent';
import { asJson, parsed } from './json-fields';

// Readers for `claude auth` output, as measured on the installed CLI.

const VISIT_PREFIX = 'visit: ';
// An OSC 8 hyperlink sequence, opening or closing, ended by BEL or ESC `\`.
// oxlint-disable-next-line no-control-regex
const OSC_8 = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

// The status `claude auth status --json` printed: `account` is
// `<email> · Claude <subscriptionType>`, or the email alone when no
// subscription is named, null when signed out. Throws when `stdout` is not
// that JSON.
export function readAccountStatus(stdout: string): AccountStatus {
  const json = parsed(stdout.trim());
  const status = asJson(json.ok ? json.value : null);
  if (typeof status.loggedIn !== 'boolean') {
    throw new Error(`claude auth status printed no status: ${stdout.trim()}`);
  }
  if (!status.loggedIn) {
    return { signedIn: false, account: null };
  }
  const { email, subscriptionType } = status;
  if (typeof email !== 'string') {
    return { signedIn: true, account: null };
  }
  const account =
    typeof subscriptionType === 'string'
      ? `${email} · Claude ${subscriptionType}`
      : email;
  return { signedIn: true, account };
}

// The sign-in URL `claude auth login` prints after `visit: `, its OSC 8
// hyperlink wrapping stripped so the URL shows once; null until that line has
// ended. `output` is everything the process printed so far, both streams.
export function signInLink(output: string): string | null {
  const start = output.indexOf(VISIT_PREFIX);
  if (start === -1) {
    return null;
  }
  const end = output.indexOf('\n', start);
  if (end === -1) {
    return null;
  }
  const url = output
    .slice(start + VISIT_PREFIX.length, end)
    .replace(OSC_8, '')
    .trim();
  return url === '' ? null : url;
}
