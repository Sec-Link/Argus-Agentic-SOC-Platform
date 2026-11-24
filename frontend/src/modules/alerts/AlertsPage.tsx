'use client';

import AlertList from './components/AlertList';
import { useGuide } from '../../components/layout/useGuide';
import type { GuideStep } from '../../components/layout/useGuide';

const GUIDE_STEPS: GuideStep[] = [
  {
    selector: '[data-tour="al-table"]',
    title: '1. Alerts',
    description: 'Every alert raised by your detection rules lands here, newest first. Click a column header to sort; drag a header edge to resize it.',
    placement: 'top',
  },
  {
    selector: '[data-tour="al-search"]',
    title: '2. Search',
    description: 'Type an ID, message, rule, host or IP to narrow the list. Results update as you type.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="al-severity"]',
    title: '3. Filter by severity',
    description: 'Pick Critical, High, Medium, Low or Unknown to focus on the alerts that need attention first.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="al-reset"]',
    title: '4. Reset',
    description: 'Clears the search, severity filter and sorting to get back to the default view.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="al-table"] .ant-table-tbody',
    title: '5. Open an alert',
    description: 'Click any row to open Alert Details with the full message, host, source IP, risk objects and raw context. The Detection Rule link jumps to the rule that fired.',
    placement: 'top',
  },
];

export default function AlertsPage() {
  const guide = useGuide(GUIDE_STEPS);
  return (
    <>
      <AlertList />
      {guide}
    </>
  );
}
