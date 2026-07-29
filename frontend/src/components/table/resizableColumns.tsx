'use client';

import React, { useState } from 'react';
import { Resizable } from 'react-resizable';
import type { ResizeCallbackData } from 'react-resizable';

/**
 * Shared drag-to-resize header cell for AntD tables.
 *
 * Usage:
 *   const { columns, components } = useResizableColumns(baseColumns);
 *   <Table columns={columns} components={components} ... />
 *
 * Column widths are tracked by column `key` (falling back to `dataIndex`), so
 * the source column array can be recomputed every render (dynamic columns,
 * live render closures) without losing user-adjusted widths.
 */
export const ResizableTitle: React.FC<any> = ({ onResize, width, ...restProps }) => {
  if (!width) return <th {...restProps} />;
  return (
    <Resizable
      width={width}
      height={0}
      handle={<span className="react-resizable-handle" onClick={(e) => e.stopPropagation()} />}
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

export function useResizableColumns<T extends Record<string, any>>(source: T[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      source
        .filter((c) => (c.key ?? c.dataIndex) != null && typeof c.width === 'number')
        .map((c) => [String(c.key ?? c.dataIndex), Number(c.width)]),
    ),
  );

  const handleResize = (key: string) => (_e: React.SyntheticEvent, data: ResizeCallbackData) => {
    setWidths((prev) => ({ ...prev, [key]: Math.max(60, Math.round(data.size.width)) }));
  };

  const columns = source.map((col) => {
    const key = String(col.key ?? col.dataIndex ?? '');
    const width = widths[key] ?? col.width;
    if (!key || typeof width !== 'number') return col;
    return {
      ...col,
      width,
      onHeaderCell: () => ({ width, onResize: handleResize(key) }),
    };
  });

  return { columns, components: { header: { cell: ResizableTitle } } };
}
