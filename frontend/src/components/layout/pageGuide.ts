'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';

// Tiny registry: a page that offers an interactive guide registers a start handler while it is mounted;
// the header shows a "Guide" button only when a handler exists.
let current: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Header side: the active page's guide starter, or null when the page has no guide. */
export const usePageGuide = (): (() => void) | null =>
  useSyncExternalStore(subscribe, () => current, () => null);

/** Page side: offer a guide for as long as the calling component is mounted. */
export const useRegisterPageGuide = (start: () => void) => {
  const ref = useRef(start);
  ref.current = start;
  useEffect(() => {
    const wrapper = () => ref.current();
    current = wrapper;
    notify();
    return () => {
      if (current === wrapper) {
        current = null;
        notify();
      }
    };
  }, []);
};
