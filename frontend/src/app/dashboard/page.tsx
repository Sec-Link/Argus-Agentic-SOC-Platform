'use client';

import { Suspense } from 'react';
import DashboardHome from '../../modules/dashboards/DashboardHome';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DashboardHome />
    </Suspense>
  );
}
