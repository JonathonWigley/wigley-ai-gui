import { describe, expect, it } from 'vitest';
import { readIfPresent } from '../../contracts/files';
import type { LoginStartStatus } from '../../contracts/login-start';
import { createMemoryFiles } from '../../shared/memory-files';
import { createLaunchAgentLoginStart } from './launch-agent-login-start';

const HOME = '/Users/someone';
const FILE = `${HOME}/Library/LaunchAgents/wigley-ai-gui.session-host.plist`;
const EXECUTABLE = '/Applications/Auri.app/Contents/MacOS/wigley-ai-gui';
const ARGUMENTS = [EXECUTABLE, '--start-session-host'];
const PLIST =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n' +
  '<dict>\n' +
  '\t<key>Label</key>\n' +
  '\t<string>wigley-ai-gui.session-host</string>\n' +
  '\t<key>ProgramArguments</key>\n' +
  '\t<array>\n' +
  `\t\t<string>${EXECUTABLE}</string>\n` +
  '\t\t<string>--start-session-host</string>\n' +
  '\t</array>\n' +
  '\t<key>RunAtLoad</key>\n' +
  '\t<true/>\n' +
  '\t<key>AbandonProcessGroup</key>\n' +
  '\t<true/>\n' +
  '</dict>\n' +
  '</plist>\n';
const SEEDED_AT = 1_000;
const SET_AT = 2_000;
const OFF: LoginStartStatus = { state: 'off', detail: null };
const ON: LoginStartStatus = { state: 'on', detail: null };

describe('createLaunchAgentLoginStart', () => {
  // Seeds `before` (null: no file) at SEEDED_AT, then runs `set(on)` at SET_AT, so a write moves `modified`.
  function launchAgent(options: {
    before: string | null;
    failDelete?: boolean;
    failWrite?: boolean;
    programArguments?: readonly string[];
  }) {
    let now = SEEDED_AT;
    const memory = createMemoryFiles({ now: () => now });
    const files = {
      ...memory,
      deleteFile: options.failDelete
        ? () => Promise.reject(new Error('delete denied'))
        : memory.deleteFile,
      write: options.failWrite
        ? () => Promise.reject(new Error('disk full'))
        : memory.write,
    };
    const loginStart = createLaunchAgentLoginStart({
      files,
      homeDir: HOME,
      programArguments: options.programArguments ?? ARGUMENTS,
    });
    return {
      memory,
      seed: async () => {
        if (options.before !== null) {
          await memory.write(FILE, options.before);
        }
        now = SET_AT;
      },
      set: (on: boolean) => loginStart.set(on),
    };
  }

  it.each<{
    name: string;
    before: string | null;
    on: boolean;
    failDelete?: boolean;
    after: string | null;
    modifiedAt: number | null;
    status: LoginStartStatus;
  }>([
    {
      name: 'writes the plist when no file is there',
      before: null,
      on: true,
      after: PLIST,
      modifiedAt: SET_AT,
      status: ON,
    },
    {
      name: 'leaves a file with the same text unwritten',
      before: PLIST,
      on: true,
      after: PLIST,
      modifiedAt: SEEDED_AT,
      status: ON,
    },
    {
      name: 'rewrites a file with other text',
      before: PLIST.replace('--start-session-host', '--older-flag'),
      on: true,
      after: PLIST,
      modifiedAt: SET_AT,
      status: ON,
    },
    {
      name: 'deletes the file when switched off',
      before: PLIST,
      on: false,
      after: null,
      modifiedAt: null,
      status: OFF,
    },
    {
      name: 'reports a delete that fails',
      before: PLIST,
      on: false,
      failDelete: true,
      after: PLIST,
      modifiedAt: SEEDED_AT,
      status: { state: 'off', detail: 'Login start failed: delete denied' },
    },
    {
      name: 'is off with no file to delete',
      before: null,
      on: false,
      after: null,
      modifiedAt: null,
      status: OFF,
    },
  ])('$name', async ({ before, on, failDelete, after, modifiedAt, status }) => {
    const agent = launchAgent({ before, failDelete });
    await agent.seed();

    expect(await agent.set(on)).toEqual(status);
    expect(await readIfPresent(agent.memory, FILE)).toBe(after);
    if (modifiedAt !== null) {
      expect(await agent.memory.modified(FILE)).toBe(modifiedAt);
    }
  });

  it('resolves to off with the reason when the write fails', async () => {
    const agent = launchAgent({ before: null, failWrite: true });
    await agent.seed();

    expect(await agent.set(true)).toEqual({
      state: 'off',
      detail: 'Login start failed: disk full',
    });
  });

  it('escapes XML in a program argument', async () => {
    const agent = launchAgent({
      before: null,
      programArguments: ['/apps/a&b<c>', '--start-session-host'],
    });
    await agent.seed();

    await agent.set(true);

    expect(await agent.memory.read(FILE)).toContain(
      '\t\t<string>/apps/a&amp;b&lt;c&gt;</string>\n',
    );
  });
});
