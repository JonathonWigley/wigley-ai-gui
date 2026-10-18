import type { Bridge } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { RendererCommands } from './renderer-commands';

export function registerAgentCommands(
  commands: RendererCommands,
  bridge: Pick<Bridge, 'promptAgent'>,
  log: Log,
) {
  commands.register('agent.submit', ({ editor }) => {
    if (!editor) {
      throw new Error('agent.submit runs in an editor, and none fired it');
    }
    const text = editor.text();
    log('agent', `sent "${text}"`);
    void bridge
      .promptAgent(text)
      .then((stopReason) => log('agent', `turn ended: ${stopReason}`));
  });
}
