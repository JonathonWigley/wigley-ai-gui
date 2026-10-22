import { describe, expect, it } from 'vitest';
import {
  requireUnambiguousKeymap,
  requireWellFormedChords,
} from '../shared/keymap-checks';
import { mergeKeymap } from '../shared/plugin-manifests';
import { defaultKeymap } from './keymap';
import { manifests } from './manifests';

// The shipped keymap is the subject here: a clash in it stops the app at
// start.
describe('defaultKeymap', () => {
  it('defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks', () => {
    const merged = mergeKeymap(defaultKeymap, manifests, {});

    expect(() => requireUnambiguousKeymap(merged)).not.toThrow();
    expect(() => requireWellFormedChords(merged.page)).not.toThrow();
  });
});
