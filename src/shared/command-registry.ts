import type { CommandId } from '../contracts/commands';

// Maps command ids to what they do. `Context` is what the trigger hands the
// command: the editor it fired in, or the chord that fired it.
export class CommandRegistry<Context> {
  private readonly handlers = new Map<CommandId, (context: Context) => void>();

  register(id: CommandId, handler: (context: Context) => void) {
    if (this.handlers.has(id)) {
      throw new Error(`Command "${id}" is already registered`);
    }
    this.handlers.set(id, handler);
  }

  has(id: CommandId): boolean {
    return this.handlers.has(id);
  }

  run(id: CommandId, context: Context) {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`No command is registered as "${id}"`);
    }
    handler(context);
  }

  // Fails at startup on a keymap naming a command nothing registered, instead
  // of on the first press of its key.
  requireRegistered(ids: Iterable<CommandId>) {
    const missing = [...new Set(ids)].filter((id) => !this.handlers.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Keymap names unregistered commands: ${missing.join(', ')}`,
      );
    }
  }
}
