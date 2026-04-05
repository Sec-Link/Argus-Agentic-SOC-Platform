import TicketDetailClient from './TicketDetailClient';

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await params;
  const ticketNumber = p?.id ? decodeURIComponent(p.id) : undefined;
  return <TicketDetailClient ticketNumber={ticketNumber} />;
}
