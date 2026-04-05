'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Workflows from '../../../modules/workflows/Workflows';
import { VisualWorkflowEditor } from '../../../modules/workflows/components';

export default function WorkflowsPage() {
  const router = useRouter();
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | undefined>(undefined);
  const [workflowView, setWorkflowView] = useState<'list' | 'visual'>('list');

  if (workflowView === 'visual') {
    return (
      <VisualWorkflowEditor
        workflowId={editingWorkflowId}
        onBack={() => {
          setWorkflowView('list');
          setEditingWorkflowId(undefined);
        }}
        onSaved={() => {
          setWorkflowView('list');
          setEditingWorkflowId(undefined);
        }}
      />
    );
  }

  return (
    <Workflows
      onNavigate={(path) => router.push(path)}
      onVisualEditWorkflow={(id?: string) => {
        setEditingWorkflowId(id);
        setWorkflowView('visual');
      }}
    />
  );
}
