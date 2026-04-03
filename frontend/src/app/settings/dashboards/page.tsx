'use client';

import React, { useState } from 'react';
import DashboardList from '../../../modules/dashboards/DashboardList';
import DashboardEditor from '../../../modules/dashboards/DashboardEditor';

export default function DashboardsPage() {
  const [editingDashboardId, setEditingDashboardId] = useState<string | undefined>(undefined);
  return editingDashboardId ? (
    <DashboardEditor dashboardId={editingDashboardId} onBack={() => setEditingDashboardId(undefined)} />
  ) : (
    <DashboardList onEdit={(id?: string) => setEditingDashboardId(id)} />
  );
}
