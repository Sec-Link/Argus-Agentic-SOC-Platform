'use client';

import { Suspense } from 'react';
import AlertsPage from '../../modules/alerts/AlertsPage';

export default function AlertsRoute() {
  return (
    <Suspense fallback={null}>
      <AlertsPage />
    </Suspense>
  );
}
