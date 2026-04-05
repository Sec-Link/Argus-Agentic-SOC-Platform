'use client';

import React from 'react';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import type { BreadcrumbProps as AntBreadcrumbProps } from 'antd';

export type BreadcrumbProps = AntBreadcrumbProps;

export default function Breadcrumb(props: BreadcrumbProps) {
  return <AntBreadcrumb {...props} />;
}
