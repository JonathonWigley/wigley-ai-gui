import type { Log } from '../contracts/log';
import type { MainCommands } from './keybindings';

// Commands that only report their chord arrived, proving the app owns it.
export function registerProofCommands(commands: MainCommands, log: Log) {
  commands.register('proof.logClaim', (chord) =>
    log('menu', `${chord} claimed`),
  );
  commands.register('proof.logIntercept', (chord) =>
    log('input', `${chord} caught before the page`),
  );
}
