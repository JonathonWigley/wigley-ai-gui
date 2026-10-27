import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import type { Log } from '../../../contracts/log';
import { unplacedBinds, unplacedLine } from './unplaced';

export interface UnplacedLogDeps {
  keymap(): Keymap;
  scope(): ViewScope;
  placedIn(scope: ViewScope): ReadonlySet<CommandId>;
  onScopeChanged(listener: (scope: ViewScope) => void): void;
  log: Log;
}

// `checkSeen` logs, under `[keys]`, each bind with no anchor in every scope
// that was in force during the page load, each line once per page load.
export interface UnplacedLog {
  checkSeen(): void;
}

// Records each scope as it first comes in force, from the one in force now;
// a scope change logs nothing.
export function startUnplacedLog(deps: UnplacedLogDeps): UnplacedLog {
  const seenScopes = new Set<ViewScope>([deps.scope()]);
  const loggedLines = new Set<string>();
  deps.onScopeChanged((scope) => seenScopes.add(scope));
  return {
    checkSeen() {
      for (const scope of seenScopes) {
        const binds = unplacedBinds(deps.keymap(), scope, deps.placedIn(scope));
        for (const bind of binds) {
          const line = unplacedLine(bind, scope);
          if (!loggedLines.has(line)) {
            loggedLines.add(line);
            deps.log('keys', line);
          }
        }
      }
    },
  };
}
