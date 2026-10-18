import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

// Runs one prompt against an ACP agent spawned as a child process over stdio,
// the way the app will drive the harness, and reports each text chunk.
export async function promptAgentProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  text: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const agentProcess = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env,
  });
  const stream = acp.ndJsonStream(
    Writable.toWeb(agentProcess.stdin),
    Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>,
  );

  try {
    const response = await acp
      .client({ name: 'wigley-ai-gui' })
      .connectWith(stream, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        return ctx.buildSession(process.cwd()).withSession(async (session) => {
          session.prompt(text);
          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === 'stop') {
              return message.response;
            }
            const update = message.notification.update;
            if (update.sessionUpdate !== 'agent_message_chunk') {
              continue;
            }
            if (update.content.type === 'text') {
              onChunk(update.content.text);
            }
          }
        });
      });
    return response.stopReason;
  } finally {
    agentProcess.kill();
  }
}
