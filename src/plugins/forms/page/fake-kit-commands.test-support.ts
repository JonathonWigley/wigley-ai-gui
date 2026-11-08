import type { CommandArgShape, CommandId } from '../../../contracts/commands';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import { formsManifest } from '../manifest';

const FORMS_COMMANDS: Readonly<
  Record<string, { label: string; arg?: CommandArgShape }>
> = formsManifest.commands;

// The manifest declaration of forms command `id`; undefined for any other id.
function formsDeclaration(id: CommandId) {
  const short = id.startsWith('forms.') ? id.slice('forms.'.length) : '';
  return Object.hasOwn(FORMS_COMMANDS, short)
    ? FORMS_COMMANDS[short]
    : undefined;
}

// The kit commands a forms card or pane under test checks and runs: every
// forms command with the arg its manifest declares, and each of `others` with
// none. Each run goes to `run`.
export function fakeFormsKitCommands(
  run: KitCommands['run'] = () => undefined,
  others: readonly CommandId[] = [],
): KitCommands {
  return {
    exists: (id) => formsDeclaration(id) !== undefined || others.includes(id),
    argShape: (id) => formsDeclaration(id)?.arg,
    run,
  };
}
