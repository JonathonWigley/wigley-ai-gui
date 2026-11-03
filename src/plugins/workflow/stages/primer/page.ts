import type { PageStage } from '../../contract';

export const primerPageStage: PageStage = {
  id: 'primer',
  label: 'Primer',
  inStepper: true,
  order: 10,
  actions: [],
  detail: () => '',
};
