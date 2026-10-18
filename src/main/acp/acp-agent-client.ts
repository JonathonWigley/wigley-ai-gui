import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentClient, StopReason } from '../../contracts/agent';

// How to start the agent executable the client speaks ACP to over stdio.
export interface AcpAgentLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

async function promptAgentProcess(
  launch: AcpAgentLaunch,
  text: string,
  onChunk: (chunk: string) => void,
): Promise<StopReason> {
  const agentProcess = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: launch.env,
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

// Spawns the agent for each turn and ends it after, until sessions outlive a turn.
export function createAcpAgentClient(launch: AcpAgentLaunch): AgentClient {
  return {
    prompt: (text, onChunk) => promptAgentProcess(launch, text, onChunk),
  };
}
