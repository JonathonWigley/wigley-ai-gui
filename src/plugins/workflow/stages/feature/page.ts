import { busyStatus, type PageStage, statusText } from '../../contract';

const label = 'Feature';
const status = busyStatus;

export const featurePageStage: PageStage = {
  id: 'feature',
  label,
  inStepper: true,
  stepSlot: 'start',
  order: 20,
  actions: [
    {
      command: 'openPlan',
      label: 'Open plan',
      side: 'page',
      available: (flow) => flow.planDir !== null,
      enabled: () => true,
    },
  ],
  detail: (flow) => (flow.progress === null ? '' : flow.progress.title),
  status,
  statusLine: (flow) => statusText(label, status(flow)),
};
