import type { PoolProvider } from '../../chat/contract';
import type { PoolSnapshot } from '../contract';

// Chat's pool provider over the watch's snapshot: `folders` gives a pool's clone paths by clone number, read at each
// call.
export function createPoolProvider(snapshot: () => PoolSnapshot): PoolProvider {
  return {
    folders: (pool) =>
      snapshot()
        .pools.find((state) => state.pool === pool)
        ?.clones.map((clone) => clone.path) ?? [],
  };
}
