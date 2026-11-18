import type { PluginStatus } from '../../../contracts/core-state';

// The built-in plugins, in `plugins` order, with no `demoSkip` and no step id under their `<id>.` prefix.
export function missingCoverage(
  plugins: readonly PluginStatus[],
  stepIds: readonly string[],
): string[] {
  return plugins
    .filter(({ id, origin, demoSkip }) => {
      const needsStep = origin === 'built-in' && demoSkip === null;
      return (
        needsStep && !stepIds.some((stepId) => stepId.startsWith(`${id}.`))
      );
    })
    .map(({ id }) => id);
}
