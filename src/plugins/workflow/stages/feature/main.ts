import type { MainStage } from '../../contract';

export const featureMainStage: MainStage = {
  id: 'feature',
  order: 20,
  enter(_flow, signal) {
    return signal.type === 'skillStarted' && signal.skill === 'wigley:feature'
      ? 'feature'
      : null;
  },
  clearsPlan: true,
};
