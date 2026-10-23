import type { SettingLeaf } from '../../../contracts/user-config';
import { isJsonObject, type JsonObject } from '../../../shared/json';

function isSameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// `layer` with `value` at `leaf.path`, each missing object on the path
// created; a value equal to the leaf's fallback removes the key instead, so
// the file keeps only what differs from the defaults.
export function withSetting(
  layer: Record<string, unknown> | null,
  leaf: SettingLeaf,
  value: unknown,
): Record<string, unknown> {
  if (leaf.fallback !== null && isSameJson(value, leaf.fallback.value)) {
    return withoutSetting(layer, leaf.path);
  }
  const keys = leaf.path.split('.');
  const root: JsonObject = { ...layer };
  let parent = root;
  for (const key of keys.slice(0, -1)) {
    const child = parent[key];
    const copy: JsonObject = isJsonObject(child) ? { ...child } : {};
    parent[key] = copy;
    parent = copy;
  }
  parent[keys[keys.length - 1]] = value;
  return root;
}

// `layer` without the key at the dotted `path`, and without each object up
// the path the removal leaves empty.
export function withoutSetting(
  layer: Record<string, unknown> | null,
  path: string,
): Record<string, unknown> {
  const keys = path.split('.');
  const root: JsonObject = { ...layer };
  const chain: JsonObject[] = [root];
  for (const key of keys.slice(0, -1)) {
    const child = chain[chain.length - 1][key];
    if (!isJsonObject(child)) {
      return root;
    }
    const copy = { ...child };
    chain[chain.length - 1][key] = copy;
    chain.push(copy);
  }
  delete chain[chain.length - 1][keys[keys.length - 1]];
  for (let depth = chain.length - 1; depth > 0; depth--) {
    if (Object.keys(chain[depth]).length > 0) {
      break;
    }
    delete chain[depth - 1][keys[depth - 1]];
  }
  return root;
}
