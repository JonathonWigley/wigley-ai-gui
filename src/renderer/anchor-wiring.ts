import type { Disposable } from '../contracts/disposable';
import type { Anchors } from './key-anchors';
import { type LiveConfig, onChangedPart } from './live-config';

// Keeps the anchors current for the page load: every anchor draws again on a
// keymap change, and shows or hides again on a scope change.
export function wireAnchors(deps: {
  live: Pick<LiveConfig, 'onChanged'>;
  scopeStack: { onChange(listener: () => void): Disposable };
  anchors: Pick<Anchors, 'redraw' | 'applyVisibility'>;
}): void {
  onChangedPart(
    deps.live,
    (served) => served.keymap,
    () => deps.anchors.redraw(),
  );
  deps.scopeStack.onChange(() => deps.anchors.applyVisibility());
}
