import type { MainStage } from '../../contract';

export const makeMainStage: MainStage = {
  id: 'make',
  order: 40,
  enter(_flow, signal) {
    return signal.type === 'skillStarted' && signal.skill === 'wigley:make'
      ? 'make'
      : null;
  },
};
