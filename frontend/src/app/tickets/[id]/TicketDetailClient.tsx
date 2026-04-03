'use client';

import { useRouter } from 'next/navigation';
import TicketsPage from '../../../modules/tickets/TicketsPage';

export default function TicketDetailClient({ ticketNumber }: { ticketNumber?: string }) {
  const router = useRouter();
  return <TicketsPage initialTicketNumber={ticketNumber} onNavigate={(path) => router.push(path)} />;
}
