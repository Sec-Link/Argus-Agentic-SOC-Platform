'use client';

import React from 'react';
import { Layout, Menu, Button, message } from 'antd';
import {
  DashboardOutlined,
  BellOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  TeamOutlined,
  LineChartOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BranchesOutlined,
  HddOutlined,
  DeploymentUnitOutlined,
  RadarChartOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { keyToPath, permissionByKey, type RouteKey } from 'route';

const { Sider } = Layout;

function iconByKey(key: RouteKey) {
  if (key === 'dashboard') return <DashboardOutlined />;
  if (key === 'alerts') return <BellOutlined />;
  if (key === 'tickets') return <UnorderedListOutlined />;
  if (key === 'assets') return <HddOutlined />;
  if (key === 'integrations') return <AppstoreOutlined />;
  if (key === 'orchestrator') return <DeploymentUnitOutlined />;
  if (key === 'interfaces') return <ApiOutlined />;
  if (key === 'correlation') return <LineChartOutlined />;
  if (key === 'workflows') return <BranchesOutlined />;
  if (key === 'workflow-executions') return <RadarChartOutlined />;
  if (key === 'permissions') return <LockOutlined />;
  if (key === 'registration-approvals') return <LockOutlined />;
  if (key === 'audit-logs') return <LockOutlined />;
  if (key === 'ai-assistant') return <TeamOutlined />;
  return null;
}

export default function Sidebar({
  siderWidth,
  siderCollapsed,
  openKeys,
  selectedKey,
  settingsItems,
  setSiderCollapsed,
  setOpenKeys,
  setIsResizing,
  setSiderWidthCustomized,
  canAccess,
  onNavigate,
}: {
  siderWidth: number;
  siderCollapsed: boolean;
  openKeys: string[];
  selectedKey: string;
  settingsItems: Array<{ key: RouteKey; label: string }>;
  setSiderCollapsed: (v: boolean) => void;
  setOpenKeys: (keys: string[]) => void;
  setIsResizing: (v: boolean) => void;
  setSiderWidthCustomized: (v: boolean) => void;
  canAccess: (perm?: string) => boolean;
  onNavigate: (path: string) => void;
}) {
  const labelOverrides = Object.fromEntries(settingsItems.map((item) => [item.key, item.label])) as Partial<
    Record<RouteKey, string>
  >;
  const routeLabel: Record<RouteKey, string> = {
    // Singular: this route is the single global landing view.
    dashboard: 'Overview',
    // Plural: list pages that manage multiple entities.
    alerts: 'Alerts',
    tickets: 'Tickets',
    assets: 'Assets',
    integrations: labelOverrides.integrations || 'Integrations',
    // Singular: platform-level engines/config domains.
    orchestrator: labelOverrides.orchestrator || 'Orchestrator',
    interfaces: labelOverrides.interfaces || 'Interfaces',
    correlation: labelOverrides.correlation || 'Correlation',
    permissions: labelOverrides.permissions || 'Access Management',
    // Shortened for compact enterprise sidebar wording.
    'registration-approvals': labelOverrides['registration-approvals'] || 'Approvals',
    'audit-logs': labelOverrides['audit-logs'] || 'Audit Logs',
    workflows: labelOverrides.workflows || 'Workflows',
    // Shortened from "Workflow Executions" to save horizontal space.
    'workflow-executions': labelOverrides['workflow-executions'] || 'Executions',
    'ai-assistant': labelOverrides['ai-assistant'] || 'AI Assistant',
    profile: 'Profile',
  };

  const navGroups: Array<{ key: string; title: string; icon: React.ReactNode; items: RouteKey[] }> = [
    {
      key: 'monitorGroup',
      // Gerund parent for high-level monitoring domain.
      title: 'Monitoring',
      icon: <DashboardOutlined />,
      items: ['dashboard', 'alerts'],
    },
    {
      key: 'investigationGroup',
      title: 'Investigation',
      icon: <TeamOutlined />,
      items: ['tickets', 'assets'],
    },
    {
      key: 'dataPipelineGroup',
      // Renamed from "Setup Pipeline" to match SIEM/SOAR standard terminology.
      title: 'Data Pipeline',
      icon: <DeploymentUnitOutlined />,
      items: ['integrations', 'orchestrator', 'correlation'],
    },
    {
      key: 'automationGroup',
      // Shortened to reduce truncation and redundant wording.
      title: 'Automation',
      icon: <BranchesOutlined />,
      items: ['interfaces', 'workflows', 'workflow-executions'],
    },
    {
      key: 'administrationGroup',
      title: 'Administration',
      icon: <LockOutlined />,
      items: ['permissions', 'ai-assistant', 'registration-approvals', 'audit-logs'],
    },
  ];

  return (
    <>
      <Sider
        width={siderWidth}
        collapsedWidth={0}
        collapsed={siderCollapsed}
        trigger={null}
        style={{
          background: 'var(--bg-sidebar)',
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 240ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            fontWeight: 700,
          }}
        >
          <div
            onClick={() => onNavigate('/dashboard')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('/dashboard');
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            aria-label="Go to dashboard"
          >
            <img
              src="/seclink-logo.jpg"
              alt="Argus logo"
              width={40}
              height={40}
              style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
            />
            <span className="argus-brand-wordmark argus-brand-wordmark-sidebar">
              Argus
            </span>
          </div>
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            onClick={() => setSiderCollapsed(true)}
            style={{ color: 'var(--text-primary)' }}
          />
        </div>

        <Menu
          mode="inline"
          className="siem-menu-pale"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          onClick={({ key }) => {
            const nextKey = String(key) as RouteKey;
            const nextPerm = permissionByKey[nextKey];
            if (nextPerm && !canAccess(nextPerm)) {
              message.warning('No permission to access this feature.');
              return;
            }
            onNavigate(keyToPath[nextKey] || '/dashboard');
          }}
          style={{ borderRight: 'none', background: 'transparent' }}
        >
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((key) => canAccess(permissionByKey[key]));
            if (visibleItems.length === 0) return null;
            return (
              <Menu.SubMenu key={group.key} icon={group.icon} title={group.title}>
                {visibleItems.map((itemKey) => (
                  <Menu.Item key={itemKey} icon={iconByKey(itemKey)}>
                    {routeLabel[itemKey]}
                  </Menu.Item>
                ))}
              </Menu.SubMenu>
            );
          })}
        </Menu>

        <div
          onMouseDown={(e) => {
            if (siderCollapsed) return;
            e.preventDefault();
            setIsResizing(true);
            setSiderWidthCustomized(true);
          }}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            background: 'var(--resizer-bg)',
          }}
        />
      </Sider>

      {siderCollapsed ? (
        <Button
          type="primary"
          icon={<MenuUnfoldOutlined />}
          onClick={() => setSiderCollapsed(false)}
          style={{ position: 'fixed', left: 10, top: 12, zIndex: 1000 }}
        />
      ) : null}
    </>
  );
}
