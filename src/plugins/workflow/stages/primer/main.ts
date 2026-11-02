import type { MainStage } from '../../contract';

export const primerMainStage: MainStage = {
  id: 'primer',
  order: 10,
  enter(_flow, signal) {
    return signal.type === 'skillStarted' &&
      signal.skill === 'wigley:feature-primer'
      ? 'primer'
      : null;
  },
  clearsPlan: true,
};
