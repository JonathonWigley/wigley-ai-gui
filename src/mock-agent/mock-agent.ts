import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

// A stand-in ACP agent: it echoes each prompt back in chunks, so the app can
// prove the client side without the real harness.

function promptText(prompt: acp.ContentBlock[]): string {
  return prompt
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

async function echoInChunks(
  sessionId: string,
  text: string,
  cx: acp.AgentContext,
): Promise<void> {
  const chunks = ['mock agent heard: ', text];
  for (const chunk of chunks) {
    await cx.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: chunk },
      },
    });
  }
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);

acp
  .agent({ name: 'wigley-mock-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
  }))
  .onRequest('session/new', () => ({ sessionId: randomUUID() }))
  .onRequest('session/prompt', async (ctx) => {
    await echoInChunks(
      ctx.params.sessionId,
      promptText(ctx.params.prompt),
      ctx.client,
    );
    return { stopReason: 'end_turn' as const };
  })
  .connect(stream);
