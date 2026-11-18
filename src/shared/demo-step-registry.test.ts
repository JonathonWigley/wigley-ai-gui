import { describe, expect, it } from 'vitest';
import type { DemoStepRegistry } from '../contracts/demo';
import { createDemoStepRegistry, pluginDemoSteps } from './demo-step-registry';
import { createRegistrations } from './registrations';

interface Step {
  id: string;
}

// The `gallery` plugin's view over a fresh core registry, with a listener on the
// view that counts its calls.
function galleryView() {
  const registry = createDemoStepRegistry<Step>();
  const registrations = createRegistrations();
  const view = pluginDemoSteps(registry, 'gallery', registrations);
  const heard = { count: 0 };
  view.onChanged(() => {
    heard.count += 1;
  });
  return { registry, registrations, view, heard };
}

describe('pluginDemoSteps', () => {
  it('register_ValidId_ListsAndNotifies', () => {
    const { registry, view, heard } = galleryView();
    const step = { id: 'gallery.open' };

    view.register(step);

    expect(registry.list()).toEqual([step]);
    expect(heard.count).toBe(1);
  });

  it.each(['notes.open', 'gallery', 'gallery.'])(
    'register_BadPrefix_Throws: %s',
    (id) => {
      const { registry, view } = galleryView();

      expect(() => view.register({ id })).toThrow(
        `demo step "${id}" must start with "gallery."`,
      );
      expect(registry.list()).toEqual([]);
    },
  );

  it.each<{
    name: string;
    second: (
      registry: DemoStepRegistry<Step>,
      view: DemoStepRegistry<Step>,
    ) => DemoStepRegistry<Step>;
  }>([
    { name: 'the same view twice', second: (_registry, view) => view },
    {
      name: 'two views over one registry',
      second: (registry) =>
        pluginDemoSteps(registry, 'gallery', createRegistrations()),
    },
  ])('register_DuplicateId_Throws: $name', ({ second }) => {
    const { registry, view } = galleryView();
    view.register({ id: 'gallery.open' });

    const again = second(registry, view);

    expect(() => again.register({ id: 'gallery.open' })).toThrow(
      'demo step "gallery.open" is already registered',
    );
  });

  it('registrationsDisposed_StepsAndListenersLeave', () => {
    const { registry, registrations, view, heard } = galleryView();
    view.register({ id: 'gallery.open' });
    const laterView = pluginDemoSteps(
      registry,
      'gallery',
      createRegistrations(),
    );

    registrations.dispose();
    const heardAtDispose = heard.count;

    expect(registry.list()).toEqual([]);
    expect(() => laterView.register({ id: 'gallery.open' })).not.toThrow();
    expect(heard.count).toBe(heardAtDispose);
  });

  it('dispose_Twice_NotifiesOnce', () => {
    const registry = createDemoStepRegistry<Step>();
    const registration = registry.register({ id: 'gallery.open' });
    let heard = 0;
    registry.onChanged(() => {
      heard += 1;
    });

    registration.dispose();
    registration.dispose();

    expect(heard).toBe(1);
    expect(registry.list()).toEqual([]);
  });
});
