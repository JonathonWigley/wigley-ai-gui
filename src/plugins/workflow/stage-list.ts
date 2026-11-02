import type { Disposable } from '../../contracts/disposable';
import type { StageId } from './contract';

// The stages one process registers (main's halves or the page's), in stage
// order, ascending, a stage of an order already held placed after it. `add`
// throws `stage <id> is already added` on a held id; its dispose removes the
// stage, and does nothing once the stage is gone.
export interface StageList<T extends { id: StageId; order: number }> {
  all(): readonly T[];
  add(stage: T): Disposable;
}

export function createStageList<
  T extends { id: StageId; order: number },
>(): StageList<T> {
  const stages: T[] = [];
  return {
    all: () => stages,
    add(stage) {
      if (stages.some((held) => held.id === stage.id)) {
        throw new Error(`stage ${stage.id} is already added`);
      }
      const at = stages.findIndex((held) => held.order > stage.order);
      stages.splice(at === -1 ? stages.length : at, 0, stage);
      return {
        dispose() {
          const index = stages.indexOf(stage);
          if (index !== -1) {
            stages.splice(index, 1);
          }
        },
      };
    },
  };
}
