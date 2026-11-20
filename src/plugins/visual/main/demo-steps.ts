import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import { FAKE_VISUAL_TEXT } from '../../../shared/fake-agent-harness';
import { createRegistrations } from '../../../shared/registrations';

// A phone screen standing in for a render an agent wrote to disk.
const SAMPLE_RENDER = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">
<rect width="390" height="844" rx="36" fill="#1d2433"/>
<text x="195" y="220" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#ffffff">Welcome back</text>
<rect x="45" y="330" width="300" height="56" rx="12" fill="#2d3748"/>
<text x="65" y="365" font-family="sans-serif" font-size="18" fill="#a0aec0">Email</text>
<rect x="45" y="404" width="300" height="56" rx="12" fill="#2d3748"/>
<text x="65" y="439" font-family="sans-serif" font-size="18" fill="#a0aec0">Password</text>
<rect x="45" y="520" width="300" height="60" rx="30" fill="#4c9aff"/>
<text x="195" y="557" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#ffffff">Sign in</text>
</svg>
`;

// A two-second clip of a box sliding across a dark screen, as WebM, standing
// in for a capture an agent wrote to disk.
const SAMPLE_CLIP_BASE64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAARfEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggRJ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDJXQYxMYXZmNjMuMS4xMDJEiYhAoOwAAAAAABZUrmvXrgEAAAAAAABO14EBc8WIC+LhZR4Kx62cgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QE95DV4JCwgaC6gXiagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/5zc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAyc3PZY8CLY8WIC+LhZR4Kx61nyKRFo4dFTkNPREVSRIeXTGF2YzYzLjEuMTAyIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjE2NjAwMDAwMAAfQ7Z1Qo7ngQCjyoEAAICCSYNCAAnwB3YAOCQcGEIAAKBn2MAFf4Ve0AAAZz///wm+9yPL6xqPADetn///93J///+9eiIYpiXqgdypv5hCAZtzXACgo5WBAFMAhgBAkpwASUAAAyAAAFn7DQCjlYEApwCGAECSnABRgAADIAAAWfsNAKOVgQD6AIYAQJKcAEwAAAMgAABZ+w0Ao5WBAU0AhgBAkpwASwAAAyAAAFn7DQCjlYEBoQCGAECSnABJ4AADIAAAWfsNAKOVgQH0AIYAQJKcAEjAAAMgAABZ+w0Ao5WBAkcAhgBAkpwAR6AAAyAAAFn7DQCjlYECmwCGAECSnABHAAADIAAAWfsNAKOVgQLuAIYAQJKcAEZgAAMgAABZ+w0Ao5WBA0EAhgDAkpwAQ2AAAyAAAFn7DQCjlYEDlQCGAECSnABFwAADIAAAWfsNAKOVgQPoAIYAQJKcAEVAAAMgAABZ+w0Ao5WBBDsAhgBAkpwAROAAAyAAAFn7DQCjlYEEjwCGAECSnABEYAADIAAAWfsNAKOVgQTiAIYAQJKcAEQAAAMgAABZ+w0Ao5WBBTUAhgBAkpwAQ6AAAyAAAFn7DQCjlYEFiQCGAECSnABDQAADIAAAWfsNAKOVgQXcAIYAQJKcAEMAAAMgAABZ+w0Ao5WBBi8AhgBAkpwAQsAAAyAAAFn7DQCjlYEGgwCGAMCSnABBQAADIAAAWfsNAKOVgQbWAIYAQJKcAEKAAAMgAABZ+w0Ao5WBBykAhgBAkpwAQkAAAyAAAFn7DQCjlYEHfQCGAECSnABCAAADIAAAWfsNAKOVgQfQAIYAQJKcAEHgAAMgAABZ+w0Ao5WBCCMAhgBAkpwAQcAAAyAAAFn7DQAcU7trkbuPs4EAt4r3gQHxggG18IED';

// The visuals step's main half: one demo session whose agent writes visuals,
// one whose message shows a render on disk by its absolute path, and one
// whose message plays a clip on disk the same way.
export function registerDemoSteps(services: MainServices): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'visual.visuals',
      enter: async (context) => {
        const render = services.paths.join(
          context.scratchDir,
          'visual-demo',
          'sign-in-render.svg',
        );
        await services.files.write(render, SAMPLE_RENDER);
        const destination = render.replaceAll('\\', '/');
        const clip = services.paths.join(
          context.scratchDir,
          'visual-demo',
          'slide-clip.webm',
        );
        await services.files.writeBytes(
          clip,
          Uint8Array.from(atob(SAMPLE_CLIP_BASE64), (c) => c.charCodeAt(0)),
        );
        return {
          sessions: {
            visual: await context.launchSession(FAKE_VISUAL_TEXT),
            image: await context.launchSession(
              `The sign-in screen as rendered: ![Sign-in render](<${destination}>)`,
            ),
            video: await context.launchSession(
              `The slide as captured: ![Slide clip](<${clip.replaceAll('\\', '/')}>)`,
            ),
          },
          dispose() {},
        };
      },
    }),
  );
  return registrations;
}
