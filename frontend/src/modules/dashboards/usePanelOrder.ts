import { useCallback, useMemo, useState } from 'react';
import type React from 'react';

const read = (key: string, defaults: string[]): string[] => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(saved)) return defaults;
    // Drop ids that no longer exist and append new ones so adding a panel never hides it.
    const known = saved.filter((id: unknown): id is string => typeof id === 'string' && defaults.includes(id));
    return [...known, ...defaults.filter((id) => !known.includes(id))];
  } catch {
    return defaults;
  }
};

/** Drag-to-reorder state for a set of panels; order persists per browser in localStorage. */
export const usePanelOrder = (storageKey: string, defaults: string[], groupOf: (id: string) => string = () => '') => {
  const [order, setOrder] = useState<string[]>(() => (typeof window === 'undefined' ? defaults : read(storageKey, defaults)));
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const persist = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage unavailable; order only lasts for this page view */
      }
    },
    [storageKey],
  );

  const move = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const next = order.filter((id) => id !== from);
      next.splice(next.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
      persist(next);
    },
    [order, persist],
  );

  const reset = useCallback(() => {
    persist(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  const panelProps = useCallback(
    (id: string) => ({
      draggable: editing,
      className: editing ? `panel-editing${over === id && dragging !== id ? ' panel-drop-target' : ''}${dragging === id ? ' panel-dragging' : ''}` : undefined,
      onDragStart: (e: React.DragEvent) => {
        if (!editing) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setDragging(id);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!editing || !dragging || groupOf(dragging) !== groupOf(id)) return;
        e.preventDefault();
        setOver(id);
      },
      onDrop: (e: React.DragEvent) => {
        if (!editing || !dragging || groupOf(dragging) !== groupOf(id)) return;
        e.preventDefault();
        move(dragging, id);
        setDragging(null);
        setOver(null);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
    }),
    [dragging, editing, groupOf, move, over],
  );

  const isDefault = useMemo(() => order.every((id, i) => id === defaults[i]), [order, defaults]);
  return { order, editing, setEditing, panelProps, reset, isDefault };
};
