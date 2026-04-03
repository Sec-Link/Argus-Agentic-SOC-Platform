'use client';

import { useRouter } from 'next/navigation';
import Correlation from '../../../modules/correlation/Correlation';

export default function CorrelationPage() {
  const router = useRouter();
  return <Correlation onNavigate={(path) => router.push(path)} />;
}
