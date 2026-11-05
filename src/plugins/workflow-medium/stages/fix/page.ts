import { busyStatus, type PageStage } from '../../../workflow/contract';
import { mediumStateOf } from '../../medium-state';

export const fixPageStage: PageStage = {
  id: 'fix',
  label: 'Fix',
  inStepper: true,
  order: 40,
  actions: [],
  detail: () => '',
  status: busyStatus,
  statusProgress(flow) {
    const { fixCycles } = mediumStateOf(flow);
    return fixCycles === 0 ? '' : ` · cycle ${fixCycles}`;
  },
};
