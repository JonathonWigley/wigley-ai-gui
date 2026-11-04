import { busyStatus, type PageStage } from '../../contract';

export const primerPageStage: PageStage = {
  id: 'primer',
  label: 'Primer',
  inStepper: true,
  stepSlot: 'start',
  order: 10,
  actions: [],
  detail: () => '',
  status: busyStatus,
};
