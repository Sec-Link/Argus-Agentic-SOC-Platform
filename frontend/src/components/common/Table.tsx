'use client';

import React from 'react';
import { Table as AntTable } from 'antd';
import type { TableProps as AntTableProps } from 'antd';

export type TableProps<RecordType extends object = any> = AntTableProps<RecordType>;

export default function Table<RecordType extends object = any>(props: TableProps<RecordType>) {
  return <AntTable<RecordType> {...props} />;
}
