import { describe, expect, it } from 'vitest';
import type { AgentAsk } from '../../../contracts/agent';
import type { SpawnExit } from '../../../contracts/processes';
import { FakeProcesses, type FakeSpawn } from '../../../shared/fake-processes';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  programNotFoundMessage,
  shimLaunch,
} from '../../../shared/program-lookup';
import { askClaude, type ClaudeAskDeps } from './claude-ask';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const SUCCESS_LINE = '{"type":"result","is_error":false,"result":"hello"}';
const SUCCESS_EXIT: SpawnExit = { code: 0, signal: null, startError: null };
const ASK_FOLDER = '/tmp/t/claude-code-ask-u1';
const INSTRUCTIONS_FILE = `${ASK_FOLDER}/instructions.md`;

function askDeps(overrides: Partial<ClaudeAskDeps> = {}) {
  const processes = new FakeProcesses();
  const files = createMemoryFiles();
  const logs: string[] = [];
  const deps: ClaudeAskDeps = {
    command: async () => ({ command: '/bin/claude', args: ['--lead'] }),
    askModel: () => 'sonnet',
    tempFolders: ['/tmp/t'],
    randomUuid: () => 'u1',
    env: { HOME: '/Users/u', CLAUDECODE: '1' },
    homeDir: '/Users/u',
    paths: posixPaths,
    log: (source, message) => logs.push(`[${source}] ${message}`),
    files,
    processes,
    ...overrides,
  };
  return { deps, processes, files, logs };
}

function askOf(
  signal: AbortSignal = new AbortController().signal,
  instructions = 'Be brief.',
): AgentAsk {
  return {
    profileDir: '~/.claude-personal',
    instructions,
    prompt: 'Tool: Bash',
    signal,
  };
}

// A finish that prints `stdout` and `stderr`, then closes with `code` or
// `signal`.
function exits(
  stdout: string,
  stderr: string,
  code: number | null,
  signal: string | null = null,
) {
  return (spawn: FakeSpawn) => {
    spawn.stdout(stdout);
    spawn.stderr(stderr);
    spawn.close({ code, signal, startError: null });
  };
}

describe('askClaude', () => {
  it.each([
    { name: 'sonnet', askModel: 'sonnet', modelArgs: ['--model', 'sonnet'] },
    { name: 'empty', askModel: '', modelArgs: [] },
  ])(
    'runs claude -p in its own temp folder with model $name',
    async ({ askModel, modelArgs }) => {
      const { deps, processes, files } = askDeps({ askModel: () => askModel });

      void askClaude(deps, askOf());
      await settle();

      const [spawn] = processes.spawns;
      expect({
        command: spawn.command,
        args: spawn.args,
        cwd: spawn.cwd,
        env: spawn.env,
        written: spawn.written,
        isInputEnded: spawn.isInputEnded,
      }).toEqual({
        command: '/bin/claude',
        args: [
          '--lead',
          '-p',
          '--system-prompt-file',
          INSTRUCTIONS_FILE,
          '--tools',
          '',
          '--strict-mcp-config',
          '--setting-sources',
          '',
          '--disable-slash-commands',
          '--no-session-persistence',
          '--output-format',
          'json',
          ...modelArgs,
        ],
        cwd: ASK_FOLDER,
        env: {
          HOME: '/Users/u',
          CLAUDE_CONFIG_DIR: '/Users/u/.claude-personal',
        },
        written: ['Tool: Bash'],
        isInputEnded: true,
      });
      expect(await files.read(INSTRUCTIONS_FILE)).toBe('Be brief.');
    },
  );

  it('passes multi-line instructions through a Windows .cmd shim', async () => {
    const COM_SPEC = 'C:\\Windows\\system32\\cmd.exe';
    const { deps, processes, files } = askDeps({
      command: async () => ({ command: 'C:\\bin\\claude.cmd', args: [] }),
    });

    void askClaude(deps, askOf(undefined, 'Be brief.\nReply in JSON.'));
    await settle();

    const [spawn] = processes.spawns;
    expect(() =>
      shimLaunch(spawn.command, spawn.args, 'windows', COM_SPEC),
    ).not.toThrow();
    expect(await files.read(INSTRUCTIONS_FILE)).toBe(
      'Be brief.\nReply in JSON.',
    );
  });

  it.each([
    {
      name: 'SplitAcrossChunks',
      chunks: [SUCCESS_LINE.slice(0, 20), `${SUCCESS_LINE.slice(20)}\n`],
    },
    {
      name: 'LeadingExtraLine',
      chunks: ['Loading profile…\n', `${SUCCESS_LINE}\r\n\n`],
    },
  ])('resolves with the result text $name', async ({ chunks }) => {
    const { deps, processes } = askDeps();

    const asked = askClaude(deps, askOf());
    await settle();
    const [spawn] = processes.spawns;
    for (const chunk of chunks) {
      spawn.stdout(chunk);
    }
    spawn.close(SUCCESS_EXIT);

    expect(await asked).toBe('hello');
  });

  it('resolves on a close that comes during the spawn', async () => {
    const fake = new FakeProcesses();
    const { deps } = askDeps({
      processes: {
        spawn: (command, args, options) => {
          fake.spawn(command, args, options);
          const [spawned] = fake.spawns;
          spawned.stdout(SUCCESS_LINE);
          spawned.close(SUCCESS_EXIT);
          return spawned;
        },
      },
    });

    expect(await askClaude(deps, askOf())).toBe('hello');
  });

  const SPAWN_NOT_FOUND: SpawnExit = {
    code: null,
    signal: null,
    startError: { message: 'spawn /bin/claude ENOENT', notFound: true },
  };

  it.each<{
    name: string;
    deps?: (controller: AbortController) => Partial<ClaudeAskDeps>;
    isAbortedAtCall?: true;
    finish?: (spawn: FakeSpawn) => void;
    message: string;
    spawns: number;
  }>([
    {
      name: 'NoTempFolder',
      deps: () => ({ tempFolders: [] }),
      message: 'no temp folder to run the ask in',
      spawns: 0,
    },
    {
      name: 'AbortedBeforeSpawn',
      isAbortedAtCall: true,
      message: 'the ask was stopped',
      spawns: 0,
    },
    {
      name: 'AbortedDuringLookup',
      deps: (controller) => ({
        command: async () => {
          controller.abort();
          return null;
        },
      }),
      message: 'the ask was stopped',
      spawns: 0,
    },
    {
      name: 'AbortedDuringMakeFolder',
      deps: (controller) => ({
        files: {
          ...createMemoryFiles(),
          makeFolder: async () => {
            controller.abort();
          },
        },
      }),
      message: 'the ask was stopped',
      spawns: 0,
    },
    {
      name: 'AbortedDuringInstructionsWrite',
      deps: (controller) => ({
        files: {
          ...createMemoryFiles(),
          write: async () => {
            controller.abort();
          },
        },
      }),
      message: 'the ask was stopped',
      spawns: 0,
    },
    {
      name: 'CommandNotFound',
      deps: () => ({ command: async () => null }),
      message: programNotFoundMessage('claude'),
      spawns: 0,
    },
    {
      name: 'CommandRejects',
      deps: () => ({
        command: () => Promise.reject(new Error('lookup failed')),
      }),
      message: 'lookup failed',
      spawns: 0,
    },
    {
      name: 'MakeFolderRejects',
      deps: () => ({
        files: {
          ...createMemoryFiles(),
          makeFolder: () => Promise.reject(new Error('EACCES')),
        },
      }),
      message: 'EACCES',
      spawns: 0,
    },
    {
      name: 'InstructionsWriteRejects',
      deps: () => ({
        files: {
          ...createMemoryFiles(),
          write: () => Promise.reject(new Error('ENOSPC')),
        },
      }),
      message: 'ENOSPC',
      spawns: 0,
    },
    {
      name: 'SpawnNotFound',
      finish: (spawn) => spawn.close(SPAWN_NOT_FOUND),
      message: 'claude was not found at /bin/claude; set claude-code.command',
      spawns: 1,
    },
    {
      name: 'IsError',
      finish: exits(
        '{"type":"result","is_error":true,"result":"Not logged in"}',
        '',
        1,
      ),
      message: 'claude -p failed: Not logged in',
      spawns: 1,
    },
    {
      name: 'IsErrorEmptyResult',
      finish: exits(
        '{"type":"result","is_error":true,"result":""}',
        'boom\n',
        1,
      ),
      message: 'claude -p failed: boom',
      spawns: 1,
    },
    {
      name: 'IsErrorNoResult',
      finish: exits('{"is_error":true}', '', 1),
      message: 'claude -p failed',
      spawns: 1,
    },
    {
      name: 'NonZeroExit',
      finish: exits('', 'bad flag\n', 2),
      message: 'claude -p exited with code 2: bad flag',
      spawns: 1,
    },
    {
      name: 'SignalExit',
      finish: exits('', '', null, 'SIGTERM'),
      message: 'claude -p exited with signal SIGTERM',
      spawns: 1,
    },
    {
      name: 'NotJson',
      finish: exits('oops', '', 0),
      message: 'claude -p printed no result',
      spawns: 1,
    },
    {
      name: 'NotAnObject',
      finish: exits('[]', '', 0),
      message: 'claude -p printed no result',
      spawns: 1,
    },
    {
      name: 'NoResultField',
      finish: exits('{"type":"result","is_error":false}', '', 0),
      message: 'claude -p printed no result',
      spawns: 1,
    },
  ])(
    'rejects $name',
    async ({ deps, isAbortedAtCall, finish, message, spawns }) => {
      const controller = new AbortController();
      if (isAbortedAtCall === true) {
        controller.abort();
      }
      const test = askDeps(deps?.(controller));

      const outcome = askClaude(test.deps, askOf(controller.signal)).catch(
        (error: unknown) => error,
      );
      await settle();
      if (finish !== undefined) {
        finish(test.processes.spawns[0]);
      }

      expect(await outcome).toHaveProperty('message', message);
      expect(test.processes.spawns).toHaveLength(spawns);
    },
  );

  it('aborting a running ask kills the child and rejects', async () => {
    const controller = new AbortController();
    const { deps, processes } = askDeps();

    const outcome = askClaude(deps, askOf(controller.signal)).catch(
      (error: unknown) => error,
    );
    await settle();
    const [spawn] = processes.spawns;
    controller.abort();
    spawn.stdout(SUCCESS_LINE);
    spawn.close(SUCCESS_EXIT);

    expect(spawn.kills).toEqual(['SIGKILL']);
    expect(await outcome).toHaveProperty('message', 'the ask was stopped');
  });

  it.each<{
    name: string;
    end: (spawn: FakeSpawn, controller: AbortController) => void;
  }>([
    { name: 'Resolves', end: exits(SUCCESS_LINE, '', 0) },
    { name: 'Rejects', end: exits('', 'bad flag\n', 2) },
    { name: 'IsAborted', end: (_spawn, controller) => controller.abort() },
  ])('deletes the instructions file once the ask $name', async ({ end }) => {
    const controller = new AbortController();
    const { deps, processes, files, logs } = askDeps();

    const outcome = askClaude(deps, askOf(controller.signal)).catch(
      () => undefined,
    );
    await settle();
    end(processes.spawns[0], controller);
    await outcome;

    expect(await files.stat(INSTRUCTIONS_FILE)).toBeNull();
    expect(logs).toEqual([]);
  });

  it('logs a failed delete of the instructions file and resolves', async () => {
    const { deps, processes, logs } = askDeps({
      files: {
        ...createMemoryFiles(),
        deleteFile: () => Promise.reject(new Error('EBUSY')),
      },
    });

    const asked = askClaude(deps, askOf());
    await settle();
    exits(SUCCESS_LINE, '', 0)(processes.spawns[0]);

    expect(await asked).toBe('hello');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(INSTRUCTIONS_FILE);
    expect(logs[0]).toContain('EBUSY');
  });
});
