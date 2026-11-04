import { IDLE_STAGE, type PageStage, statusText } from '../../contract';

const label = 'Idle';
const status: PageStage['status'] = () => null;

export const idlePageStage: PageStage = {
  id: IDLE_STAGE,
  label,
  inStepper: false,
  order: 0,
  actions: [],
  detail: () => '',
  status,
  statusLine: (flow) => statusText(label, status(flow)),
};
