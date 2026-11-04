import { busyStatus, type PageStage, statusText } from '../../contract';

const label = 'Primer';
const status = busyStatus;

export const primerPageStage: PageStage = {
  id: 'primer',
  label,
  inStepper: true,
  stepSlot: 'start',
  order: 10,
  actions: [],
  detail: () => '',
  status,
  statusLine: (flow) => statusText(label, status(flow)),
};
