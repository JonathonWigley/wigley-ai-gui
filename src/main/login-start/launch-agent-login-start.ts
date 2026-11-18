import { type Files, readIfPresent } from '../../contracts/files';
import {
  LOGIN_START_LABEL,
  type LoginStart,
} from '../../contracts/login-start';
import { errorText } from '../../shared/error-text';

// The LoginStart over a LaunchAgent file in the user's `~/Library/LaunchAgents`, which launchd loads at the next
// login. It runs no `launchctl`: a `bootout` would end the host launchd started, and every session in it.
export function createLaunchAgentLoginStart(deps: {
  files: Files;
  homeDir: string;
  programArguments: readonly string[];
}): LoginStart {
  const { files } = deps;
  const folder = `${deps.homeDir}/Library/LaunchAgents`;
  const file = `${folder}/${LOGIN_START_LABEL}.plist`;
  const text = launchAgentPlist(deps.programArguments);
  return {
    set: async (on) => {
      try {
        if (!on) {
          await files.deleteFile(file);
          return { state: 'off', detail: null };
        }
        await files.makeFolder(folder);
        if ((await readIfPresent(files, file)) !== text) {
          await files.write(file, text);
        }
        return { state: 'on', detail: null };
      } catch (error) {
        return {
          state: 'off',
          detail: `Login start failed: ${errorText(error)}`,
        };
      }
    },
  };
}

// The LaunchAgent's plist, one fixed text per argument list, so `set(true)` rewrites only a file that differs.
function launchAgentPlist(programArguments: readonly string[]): string {
  const argumentLines = programArguments
    .map((argument) => `\t\t<string>${escapeXml(argument)}</string>\n`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    '<dict>\n' +
    '\t<key>Label</key>\n' +
    `\t<string>${LOGIN_START_LABEL}</string>\n` +
    '\t<key>ProgramArguments</key>\n' +
    '\t<array>\n' +
    argumentLines +
    '\t</array>\n' +
    '\t<key>RunAtLoad</key>\n' +
    '\t<true/>\n' +
    '\t<key>AbandonProcessGroup</key>\n' +
    '\t<true/>\n' +
    '</dict>\n' +
    '</plist>\n'
  );
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
