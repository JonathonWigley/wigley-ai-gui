import type { PartPick } from './draw-part';

const DEFAULT_NAME = 'default';

// The first layout in `chain` that `layouts` holds and that `defines`;
// `default` ends the chain whatever it defines, so a part no earlier layout
// defines resolves to `default`. A name `layouts` lacks is skipped. Throws
// `layout default is not loaded` when `layouts` lacks `default`.
export function pickLayout<L>(
  chain: readonly string[],
  layouts: ReadonlyMap<string, L>,
  defines: (layout: L) => boolean,
): PartPick<L> {
  const fallback = layouts.get(DEFAULT_NAME);
  if (fallback === undefined) {
    throw new Error(`layout ${DEFAULT_NAME} is not loaded`);
  }
  for (const name of chain) {
    if (name === DEFAULT_NAME) {
      break;
    }
    const layout = layouts.get(name);
    if (layout !== undefined && defines(layout)) {
      return { name, layout };
    }
  }
  return { name: DEFAULT_NAME, layout: fallback };
}
