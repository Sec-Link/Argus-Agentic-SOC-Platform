'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { App, Tour } from 'antd';
import type { TourProps } from 'antd';
import { useRegisterPageGuide } from './pageGuide';

export interface GuideStep {
  /** CSS selector of the element to highlight, normally `[data-tour="<page>-<name>"]`. */
  selector: string;
  title: string;
  description: React.ReactNode;
  placement?: TourProps['placement'];
}

// Inactive antd tabs stay mounted but hidden, so only a rendered (visible) element counts as present.
const find = (selector: string) => {
  const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.getClientRects().length > 0);
  return el ?? null;
};

/**
 * Offer a manual, step-by-step guide for the calling page (shown via the header "Guide" button).
 * Steps whose target is not on screen right now (other tabs, empty states, collapsed panels) are skipped.
 * Render the returned element once inside the page.
 */
export const useGuide = (steps: GuideStep[]): React.ReactNode => {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);

  const start = useCallback(() => {
    if (!steps.some((s) => find(s.selector))) {
      message.info('There is nothing to guide on this view yet.');
      return;
    }
    setOpen(true);
  }, [steps, message]);
  useRegisterPageGuide(start);

  const present = useMemo<TourProps['steps']>(
    () =>
      open
        ? steps
            .filter((s) => find(s.selector))
            .map((s) => ({
              title: s.title,
              description: s.description,
              placement: s.placement,
              target: () => find(s.selector) as HTMLElement,
            }))
        : [],
    [open, steps],
  );

  if (!open || !present || present.length === 0) return null;
  return <Tour open steps={present} onClose={() => setOpen(false)} />;
};
