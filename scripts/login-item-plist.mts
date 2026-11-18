import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// `LOGIN_START_LABEL` and `LOGIN_START_FLAG` in `src/contracts/login-start.ts`,
// which `scripts/` cannot import; `login-start-copies.test.mts` holds the copies
// together.
export const LOGIN_START_LABEL = 'wigley-ai-gui.session-host';
export const LOGIN_START_FLAG = '--start-session-host';

// The `agentService` login item that starts the session host at login: macOS
// runs the bundle's executable with `LOGIN_START_FLAG`, and the app starts the
// host detached and exits.
export function writeLoginItemPlist(
  appPath: string,
  executableName: string,
): void {
  const folder = path.join(appPath, 'Contents', 'Library', 'LaunchAgents');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, `${LOGIN_START_LABEL}.plist`),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '\t<key>Label</key>',
      `\t<string>${LOGIN_START_LABEL}</string>`,
      '\t<key>BundleProgram</key>',
      `\t<string>Contents/MacOS/${executableName}</string>`,
      '\t<key>ProgramArguments</key>',
      '\t<array>',
      `\t\t<string>${executableName}</string>`,
      `\t\t<string>${LOGIN_START_FLAG}</string>`,
      '\t</array>',
      '\t<key>RunAtLoad</key>',
      '\t<true/>',
      '\t<key>AbandonProcessGroup</key>',
      '\t<true/>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n'),
  );
}
