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

// The visuals step's main half: one demo session whose agent writes visuals,
// and one whose message shows a render on disk by its absolute path.
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
        return {
          sessions: {
            visual: await context.launchSession(FAKE_VISUAL_TEXT),
            image: await context.launchSession(
              `The sign-in screen as rendered: ![Sign-in render](<${destination}>)`,
            ),
          },
          dispose() {},
        };
      },
    }),
  );
  return registrations;
}
