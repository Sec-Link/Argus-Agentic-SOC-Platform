'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TicketsPage from '../../modules/tickets/TicketsPage';

export default function TicketsRoute() {
  const router = useRouter();
  return (
    <Suspense fallback={null}>
      <TicketsPage onNavigate={(path) => router.push(path)} />
    </Suspense>
  );
}
