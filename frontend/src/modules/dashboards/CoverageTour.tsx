import React, { useEffect, useState } from 'react';
import { Tour } from 'antd';
import type { TourProps } from 'antd';

export type TourMode = 'overview' | 'coverage';

interface StepDef {
  selector: string;
  title: string;
  description: React.ReactNode;
  placement?: TourProps['placement'];
}

const find = (selector: string) => document.querySelector<HTMLElement>(selector);

const STEPS: Record<TourMode, StepDef[]> = {
  overview: [
    {
      selector: '[data-tour="ov-card"]',
      title: 'Detection coverage at a glance',
      description:
        'This card answers two questions: are our log sources actually sending data, and which attacker techniques do our enabled rules cover?',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="ov-setup"]',
      title: 'Start here',
      description: 'Coverage is not set up yet. Click this button to open Coverage settings, scan Elasticsearch and classify your log sources.',
      placement: 'top',
    },
    {
      selector: '[data-tour="ov-card"] .cov-stats',
      title: 'Key numbers',
      description:
        'Coverage, receiving categories and rule counts. Hover a ? for a short definition, click it for how the number is calculated, and click the number itself to see exactly which categories or rules it covers.',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="ov-tiles"]',
      title: 'Log source categories',
      description: 'One tile per category (EDR, Firewall, Identity ...). Green means logs arrived recently; red means the category is silent. Click a tile to manage its sources.',
      placement: 'top',
    },
    {
      selector: '[data-tour="ov-heatmap"]',
      title: 'MITRE ATT&CK heatmap',
      description:
        'Each cell is a technique; colour shows how many enabled rules cover it. Click a tactic or technique to jump to the matching rules in Detection.',
      placement: 'top',
    },
    {
      selector: '[data-tour="ov-layout"]',
      title: 'Make it yours',
      description: 'Customize layout lets you drag panels into your preferred order. The order is saved in this browser.',
      placement: 'bottom',
    },
    {
      selector: '[data-node-key="coverage"]',
      title: 'Configure coverage',
      description: 'Scanning sources, classifying them and syncing the ATT&CK catalog all happen in Coverage settings.',
      placement: 'bottom',
    },
  ],
  coverage: [
    {
      selector: '[data-tour="ls-actions"]',
      title: '1. Scan your log sources',
      description:
        'Rescan reads index and data stream names from Elasticsearch (it never runs on page load). Configure opens a full list where you can reassign or ignore sources.',
      placement: 'bottomRight',
    },
    {
      selector: '[data-tour="ls-card"] .cov-stats',
      title: '2. Read the results',
      description: 'These numbers summarise log coverage and how many enabled rules can actually fire. Click any number to see the details behind it.',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="ls-pool"]',
      title: '3. Classify unknown sources',
      description: 'Sources no rule could classify land here. Drag one onto a category below, or click × to ignore noise such as metrics indices.',
      placement: 'bottom',
    },
    {
      selector: '[data-tour="ls-cats"]',
      title: '4. Categories and their sources',
      description: 'Drop sources onto a category to assign them. Chip colours show alerting status (use the colour legend ? at the top right to see what each means).',
      placement: 'top',
    },
    {
      selector: '[data-tour="at-sync"]',
      title: '5. Load the ATT&CK catalog',
      description: 'Sync the MITRE ATT&CK catalog once so coverage is measured against the full technique list. Existing rules are re-mapped automatically.',
      placement: 'bottomRight',
    },
    {
      selector: '[data-tour="at-tactics"]',
      title: '6. Improve ATT&CK coverage',
      description:
        'Bars show covered techniques per tactic. To raise coverage, open a rule, add tags like attack.persistence then attack.t1053.005, enable it and publish it to Kibana. Hover a bar to see what is covered.',
      placement: 'top',
    },
  ],
};

const CoverageTour: React.FC<{ mode: TourMode; open: boolean; onClose: () => void }> = ({ mode, open, onClose }) => {
  const [steps, setSteps] = useState<TourProps['steps']>([]);

  // Only keep steps whose target is on screen right now (cards may be unconfigured, collapsed or still loading).
  useEffect(() => {
    if (!open) return;
    const present = STEPS[mode].filter((s) => find(s.selector));
    setSteps(
      present.map((s) => ({
        title: s.title,
        description: s.description,
        placement: s.placement,
        target: () => find(s.selector) as HTMLElement,
      })),
    );
  }, [open, mode]);

  if (!open || !steps || steps.length === 0) return null;
  return (
    <Tour
      open
      steps={steps}
      onClose={onClose}
    />
  );
};

export default CoverageTour;
