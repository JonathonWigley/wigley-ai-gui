import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { Shells } from './shells';

export interface TerminalDemoMainDeps {
  shells: Pick<Shells, 'type' | 'kill'>;
}

// The Terminal step's main half: a session whose agent has typed a sign-in
// command at its shell prompt, awaiting the user's Enter.
export function registerDemoSteps(
  services: MainServices,
  deps: TerminalDemoMainDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'terminal.drawer',
    async enter(context) {
      const session = await context.launchSession('Sign in to the cloud.');
      await deps.shells.type(session, 'gcloud auth login');
      return {
        sessions: { session },
        dispose() {
          deps.shells.kill(session);
        },
      };
    },
  });
}
