'use client';

import { useRouter } from 'next/navigation';
import TicketsPage from '../../modules/tickets/TicketsPage';

export default function TicketsRoute() {
  const router = useRouter();
  return <TicketsPage onNavigate={(path) => router.push(path)} />;
}
