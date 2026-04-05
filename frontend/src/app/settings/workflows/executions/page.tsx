'use client';

import { useRouter } from 'next/navigation';
import WorkflowExecutions from '../../../../modules/workflows/WorkflowExecutions';

export default function WorkflowExecutionsPage() {
  const router = useRouter();
  return <WorkflowExecutions onBack={() => router.push('/settings/workflows')} />;
}
