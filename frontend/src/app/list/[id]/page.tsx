import { redirect } from 'next/navigation';

export default async function ListDetailAliasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await params;
  const id = p?.id ? encodeURIComponent(p.id) : '';
  redirect(`/tickets/${id}`);
}
